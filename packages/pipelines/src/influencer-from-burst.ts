/**
 * influencer-from-burst — the corrected discovery logic (Instagram-only).
 *
 *   1. COMPETITOR products (not the user's brand) → Keepa → biggest steady-price
 *      rank burst within the last 1 year → (competitor, product, date D).
 *   2. Instagram hashtag search on the COMPETITOR's brand (+ mined tag variants),
 *      deep-paginated, client-filtered to the burst window [D-7, D].
 *   3. Rank in-window IG posts by engagement → TOP 3 distinct creators.
 *
 * Brand-relevant by construction: these creators literally posted about a
 * competitor's product right before its Amazon rank jumped. NEVER throws.
 */
import { createKeepaAdapter, resolveInstagramProfile, type BrandOnboarding } from "@pebble/providers";
import { findMarketMovers } from "@pebble/engine";
import { createBb, createIngestionWriter } from "@pebble/bb";
import type { NormalizedProductPoint, DateString } from "@pebble/core";
import type { InfluencerSuggestion } from "./types.js";

const SC_BASE = "https://api.scrapecreators.com";
const DAY = 86400000;

export interface ChartPoint { date: string; rank: number; price: number | null; spike: boolean; }
export interface BurstContext {
  competitor: string;
  asin: string;
  productTitle: string;
  productImage?: string;
  date: DateString;
  rankFrom: number;
  rankTo: number;
  z: number;
  /** the winning product's daily rank+price series (for the chart). */
  points?: ChartPoint[];
}
export interface BurstInfluencerResult {
  burst: BurstContext | null;
  influencers: InfluencerSuggestion[];
}

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/* ------------------------- brand-name resolution ------------------------- */

// Common DTC domain affixes — "getrael" → "rael", "shopglossier" → "glossier".
const DOMAIN_PREFIXES = ["get", "shop", "try", "buy", "the", "go", "join", "use", "my", "drink", "eat"];
const DOMAIN_SUFFIXES = ["official", "store", "shop", "beauty", "care", "cosmetics", "hq", "co", "app", "inc"];

/** Strip a leading/trailing DTC affix from a domain-style brand label (lowercased, alnum only). */
function deAffix(name: string): string {
  let s = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const p of DOMAIN_PREFIXES) {
    if (s.length > p.length + 2 && s.startsWith(p)) { s = s.slice(p.length); break; }
  }
  for (const suf of DOMAIN_SUFFIXES) {
    if (s.length > suf.length + 2 && s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
  }
  return s;
}

/** Host label of a homepage URL with www + TLD stripped: "https://www.getrael.com" → "getrael". */
function hostLabel(url?: string): string {
  if (!url) return "";
  try {
    const h = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
    const parts = h.replace(/^www\./i, "").split(".");
    return (parts.length > 1 ? parts.slice(0, -1).join(".") : parts[0] ?? "").toLowerCase();
  } catch {
    return "";
  }
}

/** Ordered, deduped list of brand-name candidates to try on Keepa. */
function brandCandidates(brand: BrandOnboarding): string[] {
  const out: string[] = [];
  const push = (c?: string) => {
    const v = (c ?? "").trim();
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  push(brand.brand);                 // (a) as onboarded
  push(deAffix(brand.brand || ""));  // (b) de-affixed (getrael → rael)
  const host = hostLabel(brand.homepageUrl); // (c) homepage host label
  push(host);
  push(deAffix(host));               // and its de-affixed form
  return out.filter(Boolean);
}

/* ----------------------------- Instagram I/O ----------------------------- */

interface IgPost { id: string; handle: string; takenMs: number; views: number; likes: number; comments: number; caption: string; url: string; isPaid: boolean; thumbnailUrl?: string; videoUrl?: string; avatarUrl?: string; }

async function igHashtagPage(key: string, tag: string, cursor: number | string): Promise<{ posts: any[]; next: any }> {
  const u = `${SC_BASE}/v1/instagram/search/hashtag?hashtag=${encodeURIComponent(tag)}${cursor ? `&cursor=${cursor}` : ""}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(u, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) return { posts: [], next: null };
      const d: any = await r.json();
      return { posts: Array.isArray(d.posts) ? d.posts : [], next: d.cursor };
    } catch { if (attempt === 2) return { posts: [], next: null }; await new Promise((s) => setTimeout(s, 1200)); }
  }
  return { posts: [], next: null };
}

const parseMs = (iso: unknown): number | null => {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

function toIgPost(p: any): IgPost | null {
  const handle = p?.owner?.username;
  const takenMs = parseMs(p?.taken_at);
  if (!handle || takenMs == null) return null;
  return {
    id: String(p.id ?? p.shortcode ?? ""),
    handle: String(handle).toLowerCase(),
    takenMs,
    views: Number(p.video_play_count ?? p.video_view_count ?? 0) || 0,
    likes: Number(p.like_count ?? 0) || 0,
    comments: Number(p.comment_count ?? 0) || 0,
    caption: String(p.caption ?? "").slice(0, 120),
    url: String(p.url ?? (p.shortcode ? `https://www.instagram.com/p/${p.shortcode}/` : "")),
    isPaid: Boolean(p.is_paid_partnership),
    thumbnailUrl: (p.display_url || p.thumbnail_src) ? String(p.display_url ?? p.thumbnail_src) : undefined,
    videoUrl: p.is_video && p.video_url ? String(p.video_url) : undefined,
    avatarUrl: p.owner?.profile_pic_url ? String(p.owner.profile_pic_url) : undefined,
  };
}

/** Mine the most common co-occurring hashtags from a few seed pages. */
async function mineHashtags(key: string, seed: string): Promise<string[]> {
  const count = new Map<string, number>();
  let cursor: any = "";
  for (let i = 0; i < 2; i++) {
    const { posts, next } = await igHashtagPage(key, seed, cursor);
    for (const p of posts) {
      for (const h of String(p?.caption ?? "").match(/#[\w]+/g) ?? []) {
        const t = h.slice(1).toLowerCase();
        if (t.length > 1) count.set(t, (count.get(t) ?? 0) + 1);
      }
    }
    if (!next || next === cursor) break; cursor = next;
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

/** Deep-collect IG posts for a set of tags, deduped by post id. */
async function collectIg(key: string, tags: string[], pagesPerTag: number, emit: (s: string) => void): Promise<IgPost[]> {
  const seen = new Set<string>(); const out: IgPost[] = [];
  for (const tag of tags) {
    let cursor: any = "";
    for (let i = 0; i < pagesPerTag; i++) {
      const { posts, next } = await igHashtagPage(key, tag, cursor);
      if (!posts.length) break;
      for (const raw of posts) { const p = toIgPost(raw); if (p && p.id && !seen.has(p.id)) { seen.add(p.id); out.push(p); } }
      if (!next || next === cursor) break; cursor = next;
    }
  }
  return out;
}

const engagement = (p: IgPost) => p.views > 0 ? p.views : p.likes * 30 + p.comments * 60;

/* ------------ authenticated Instagram tagged feed (real content) ---------- */

const IG_APPID = "936619743392459";

async function igAuthedGet(url: string, env: Record<string, string | undefined>): Promise<any | null> {
  const sid = env.IG_SESSIONID?.trim();
  if (!sid) return null;
  try {
    const r = await fetch(url, {
      headers: { "x-ig-app-id": IG_APPID, cookie: `sessionid=${sid}`, "user-agent": "Instagram 309.0.0.0 Android" },
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/** Resolve a brand name → its official IG { pk, handle } via the authed API. */
async function resolveBrandHandle(brand: string, env: Record<string, string | undefined>): Promise<{ pk: string; handle: string } | null> {
  const direct = brand.toLowerCase().replace(/[^a-z0-9._]/g, "");
  const d = await igAuthedGet(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(direct)}`, env);
  const u = d?.data?.user;
  if (u?.id) return { pk: String(u.id), handle: String(u.username ?? direct) };
  // fall back to top-search and pick the best (verified, then most followers)
  const s = await igAuthedGet(`https://i.instagram.com/api/v1/web/search/topsearch/?query=${encodeURIComponent(brand)}`, env);
  const users = (s?.users ?? []).map((x: any) => x.user).filter(Boolean);
  users.sort((a: any, b: any) => (Number(b.is_verified) - Number(a.is_verified)) || ((b.follower_count ?? 0) - (a.follower_count ?? 0)));
  const top = users[0];
  if (top && (top.pk || top.id)) return { pk: String(top.pk ?? top.id), handle: String(top.username) };
  return null;
}

/** Paginate the authed tagged feed back to `sinceMs` (feed is newest-first). */
async function fetchTaggedFeed(pk: string, sinceMs: number, maxPages: number, env: Record<string, string | undefined>): Promise<IgPost[]> {
  const out: IgPost[] = [];
  let maxId = "";
  for (let i = 0; i < maxPages; i++) {
    const url = `https://i.instagram.com/api/v1/usertags/${pk}/feed/?count=24${maxId ? `&max_id=${encodeURIComponent(maxId)}` : ""}`;
    const d = await igAuthedGet(url, env);
    const items: any[] = d?.items ?? [];
    if (!items.length) break;
    let oldest = Infinity;
    for (const it of items) {
      const m = it.media ?? it;
      const ts = m.taken_at;
      if (typeof ts !== "number") continue;
      const ms = ts * 1000;
      if (ms < oldest) oldest = ms;
      const handle = m.user?.username;
      if (!handle) continue;
      out.push({
        id: String(m.id ?? m.code ?? ""),
        handle: String(handle).toLowerCase(),
        takenMs: ms,
        views: Number(m.play_count ?? m.view_count ?? 0) || 0,
        likes: Number(m.like_count ?? 0) || 0,
        comments: Number(m.comment_count ?? 0) || 0,
        caption: String(m.caption?.text ?? "").slice(0, 120),
        url: m.code ? `https://www.instagram.com/p/${m.code}/` : "",
        isPaid: Boolean(m.is_paid_partnership),
      });
    }
    if (!d?.more_available || !d?.next_max_id) break;
    if (oldest < sinceMs) break; // newest-first → once a page predates the window, stop
    maxId = String(d.next_max_id);
  }
  return out;
}

/* ------------------------------- main ------------------------------- */

export async function findInfluencersFromBurst(opts: {
  brand: BrandOnboarding;
  emit: (s: string) => void;
  maxCompetitors?: number;
  asinsPerCompetitor?: number;
  igPagesPerTag?: number;
  taggedPages?: number;
  /** Only resolve the competitor-burst CHART (skip the Instagram creator search). */
  chartOnly?: boolean;
  env?: Record<string, string | undefined>;
}): Promise<BurstInfluencerResult> {
  const env = opts.env ?? process.env;
  const emit = opts.emit;
  const none: BurstInfluencerResult = { burst: null, influencers: [] };

  const keepaKey = env.KEEPA_API_KEY?.trim();
  const scKey = env.SCRAPECREATORS_API_KEY?.trim();
  if (!keepaKey) { emit("Missing Keepa key — can't analyze Amazon sales-rank."); return none; }

  const keepa = createKeepaAdapter(keepaKey, 1);

  // CHART (option A): the SEARCHED brand's OWN real Amazon rank/price history —
  // NOT a fixture, NOT a competitor. Use its onboarded seed ASINs when present
  // (fast, no extra Keepa call), else resolve the brand on Keepa. Only Keepa is
  // needed here; ScrapeCreators is not.
  if (opts.chartOnly) {
    const subject = opts.brand.brand || "the brand";
    const limit = opts.asinsPerCompetitor ?? 10;
    emit(`Pulling ${subject}'s real Amazon sales-rank history…`);

    // 1) Prefer onboarded seed ASINs (fast, no extra Keepa call).
    let asins = (opts.brand.seedAsins ?? []).map((a) => String(a).trim()).filter(Boolean).slice(0, limit);

    // 2) No seeds → try each brand-name candidate (as-is, de-affixed, host label)
    //    until one resolves on Keepa. Fixes "getrael" (domain) → "rael".
    if (!asins.length) {
      const candidates = brandCandidates(opts.brand);
      for (const cand of candidates) {
        const found = await keepa.resolveBrand(cand, limit).catch(() => [] as { asin: string }[]);
        const got = found.map((f) => f.asin).filter(Boolean).slice(0, limit);
        if (got.length) {
          if (cand.toLowerCase() !== subject.toLowerCase()) emit(`Matched ${subject} on Amazon as "${cand}".`);
          asins = got;
          break;
        }
      }
    }

    if (!asins.length) { emit(`No Amazon products found for ${subject}.`); return none; }
    const best = await strongestBurst(keepa, subject, asins, emit);
    if (best) emit(`${subject} on Amazon: "${best.productTitle.slice(0, 40)}" — rank #${best.rankFrom.toLocaleString()} → #${best.rankTo.toLocaleString()} on ${best.date}.`);
    else emit(`No sales-rank history for ${subject}.`);
    return { burst: best, influencers: [] };
  }

  if (!scKey) { emit("Missing ScrapeCreators key — can't run the creator search."); return none; }
  const competitors = (opts.brand.competitors.length ? opts.brand.competitors : []).slice(0, opts.maxCompetitors ?? 3);
  if (competitors.length === 0) { emit("No competitors identified — can't analyze competitor products."); return none; }
  let writer: ReturnType<typeof createIngestionWriter> | null = null;
  try { writer = createIngestionWriter(createBb()); } catch { writer = null; }

  const cutoff = Date.now() - 365 * DAY;
  let best: (BurstContext & { strength: number }) | null = null;

  // 1) biggest steady-price burst across competitor products, within 1 year
  for (const competitor of competitors) {
    try {
      emit(`Checking ${competitor}'s Amazon products for sales-rank bursts…`);
      const found = await keepa.resolveBrand(competitor, opts.asinsPerCompetitor ?? 8);
      const asins = found.map((f) => f.asin).slice(0, opts.asinsPerCompetitor ?? 8);
      if (!asins.length) continue;
      const raw = await keepa.getProductsHistory(asins);
      const norm = keepa.normalizeProductHistory(raw);
      if (writer) await writer.upsertCommerce(norm, "keepa", { slug: slugify(competitor), name: competitor }).catch(() => undefined);

      const byAsin = new Map<string, NormalizedProductPoint[]>();
      for (const pt of norm.points) { const a = byAsin.get(pt.externalId) ?? []; a.push(pt); byAsin.set(pt.externalId, a); }
      for (const [asin, pts] of byAsin) {
        if (pts.length < 8) continue;
        pts.sort((a, b) => (a.snapshotDate < b.snapshotDate ? -1 : 1));
        const dates = pts.map((p) => p.snapshotDate); const ranks: number[] = []; let last = 0;
        for (const p of pts) { if (p.rank != null) last = p.rank; ranks.push(p.rank ?? last); }
        const prices = pts.map((p) => p.price ?? null);
        const res = findMarketMovers({ product: { asin }, series: { dates, ranks, prices }, content: [] });
        const prod = norm.products.find((p) => p.externalId === asin);
        const title = prod?.title ?? asin;
        const spikeSet = new Set(res.spikes.filter((s) => s.gate === "passed").map((s) => s.date));
        const points: ChartPoint[] = dates.map((dd, i) => ({ date: dd, rank: ranks[i] ?? 0, price: prices[i] ?? null, spike: spikeSet.has(dd) }));
        for (const s of res.spikes) {
          if (s.gate !== "passed") continue;
          const ms = Date.parse(`${s.date}T00:00:00Z`);
          if (ms < cutoff) continue;
          const strength = s.rankFrom - s.rankTo;
          if (!best || strength > best.strength) best = { competitor, asin, productTitle: title, productImage: prod?.imageUrl ?? undefined, date: s.date, rankFrom: s.rankFrom, rankTo: s.rankTo, z: s.z, strength, points };
        }
      }
    } catch (e) { emit(`(${competitor}: ${(e as Error).message ?? "skipped"})`); }
  }

  // The burst (if any) picks WHICH competitor to search + gives the viz context;
  // it is NOT a hard filter on creators (that was what zeroed the list).
  const target = best ? best.competitor : competitors[0]!;
  const D = best ? Date.parse(`${best.date}T00:00:00Z`) : 0;
  if (best) {
    emit(`Biggest competitor mover: ${best.competitor}'s "${best.productTitle.slice(0, 48)}" — Amazon #${best.rankFrom}→#${best.rankTo} on ${best.date} (price held).`);
  } else {
    emit(`No clear Amazon burst — recommending top ${target} creators on Instagram.`);
  }

  // chart-only: caller just wants the competitor burst series for the chart.
  if (opts.chartOnly) return { burst: best, influencers: [] };

  // 2) FIND CONTENT WITH HASHTAGS (no auth): search the competitor brand's
  //    hashtag(s) on Instagram, mine variants, collect posts with engagement.
  const seedTag = slugify(target).replace(/-/g, "");
  emit(`Searching Instagram #${seedTag} for ${target} content…`);
  const mined = await mineHashtags(scKey, seedTag);
  const tags = [seedTag, ...mined.filter((t) => (t.includes(seedTag) || seedTag.includes(t)) && t !== seedTag)].slice(0, 3);
  const posts = await collectIg(scKey, tags, opts.igPagesPerTag ?? 20, emit);

  // Light relevance gate: caption mentions the brand (cuts common-name noise
  // like people named "Cora") or it's a paid partnership. Ungated fallback if
  // that leaves too few.
  const relevant = posts.filter((p) => p.caption.toLowerCase().includes(seedTag) || p.isPaid);
  const pool = relevant.length >= 3 ? relevant : posts;
  if (pool.length === 0) {
    emit(`No Instagram content found for ${target}.`);
    return { burst: best, influencers: [] };
  }

  // 3) MOST VIRAL → the TOP 6 reels by views, one per creator (distinct), each
  //    carried with its reel media so the UI can show a 3×2 reel grid.
  const bestPerHandle = new Map<string, IgPost>();
  for (const p of pool.sort((a, b) => engagement(b) - engagement(a))) {
    if (!bestPerHandle.has(p.handle)) bestPerHandle.set(p.handle, p);
  }
  const top = [...bestPerHandle.values()].sort((a, b) => engagement(b) - engagement(a)).slice(0, 6);
  emit(`Top ${target} reels by views: ${top.map((t) => "@" + t.handle).join(", ")}. Enriching profiles…`);

  const influencers: InfluencerSuggestion[] = [];
  for (const p of top) {
    const i = influencers.length;
    const prof = await resolveInstagramProfile(p.handle).catch(() => null);
    const metric = p.views > 0 ? `${p.views.toLocaleString()} views` : `${p.likes.toLocaleString()} likes`;
    const nearBurst = Boolean(best) && Math.abs(p.takenMs - D) <= 14 * DAY;
    influencers.push({
      handle: p.handle,
      platform: "instagram",
      pk: prof?.pk,
      followers: prof?.followers ?? undefined,
      score: Math.round((0.95 - i * 0.06) * 100) / 100,
      rationale: `Posted about ${target} — ${metric}${p.isPaid ? " · paid partnership" : ""}${nearBurst ? ` · lines up with its Amazon #${best!.rankFrom}→#${best!.rankTo} jump` : ""}.`,
      postUrl: p.url || undefined,
      thumbnailUrl: p.thumbnailUrl,
      videoUrl: p.videoUrl,
      avatarUrl: p.avatarUrl ?? prof?.profilePicUrl,
    });
  }
  return { burst: best, influencers };
}

/**
 * The strongest sales-rank story across a set of ASINs, with the full daily
 * rank+price series for the chart. Prefers a steady-price (gate "passed") burst
 * in the last year; if none passes, falls back to the product with the biggest
 * rank improvement so a real chart still renders. Returns null only when no
 * product has enough history.
 */
async function strongestBurst(
  keepa: ReturnType<typeof createKeepaAdapter>,
  label: string,
  asins: string[],
  emit: (s: string) => void,
): Promise<(BurstContext & { strength: number }) | null> {
  let best: (BurstContext & { strength: number }) | null = null; // steady-price burst
  let fallback: (BurstContext & { strength: number }) | null = null; // most movement, any gate
  const cutoff = Date.now() - 365 * DAY;
  try {
    const raw = await keepa.getProductsHistory(asins);
    const norm = keepa.normalizeProductHistory(raw);
    const byAsin = new Map<string, NormalizedProductPoint[]>();
    for (const pt of norm.points) { const a = byAsin.get(pt.externalId) ?? []; a.push(pt); byAsin.set(pt.externalId, a); }
    for (const [asin, pts] of byAsin) {
      if (pts.length < 8) continue;
      pts.sort((a, b) => (a.snapshotDate < b.snapshotDate ? -1 : 1));
      const dates = pts.map((p) => p.snapshotDate);
      const ranks: number[] = []; let last = 0;
      for (const p of pts) { if (p.rank != null) last = p.rank; ranks.push(p.rank ?? last); }
      const prices = pts.map((p) => p.price ?? null);
      const res = findMarketMovers({ product: { asin }, series: { dates, ranks, prices }, content: [] });
      const prod = norm.products.find((p) => p.externalId === asin);
      const title = prod?.title ?? asin;
      const spikeSet = new Set(res.spikes.filter((s) => s.gate === "passed").map((s) => s.date));
      const points: ChartPoint[] = dates.map((dd, i) => ({ date: dd, rank: ranks[i] ?? 0, price: prices[i] ?? null, spike: spikeSet.has(dd) }));
      const meta = { competitor: label, asin, productTitle: title, productImage: prod?.imageUrl ?? undefined, points };
      for (const s of res.spikes) {
        if (s.gate !== "passed") continue;
        if (Date.parse(`${s.date}T00:00:00Z`) < cutoff) continue;
        const strength = s.rankFrom - s.rankTo;
        if (!best || strength > best.strength) best = { ...meta, date: s.date, rankFrom: s.rankFrom, rankTo: s.rankTo, z: s.z, strength };
      }
      const valid = ranks.filter((r) => r > 0);
      if (valid.length) {
        const minR = Math.min(...valid), maxR = Math.max(...valid), strength = maxR - minR;
        if (!fallback || strength > fallback.strength) {
          fallback = { ...meta, date: dates[ranks.indexOf(minR)] ?? dates[dates.length - 1]!, rankFrom: maxR, rankTo: minR, z: 0, strength };
        }
      }
    }
  } catch (e) { emit(`(${label}: ${(e as Error).message ?? "skipped"})`); }
  return best ?? fallback;
}
