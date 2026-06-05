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

export interface BurstContext {
  competitor: string;
  asin: string;
  productTitle: string;
  date: DateString;
  rankFrom: number;
  rankTo: number;
  z: number;
}
export interface BurstInfluencerResult {
  burst: BurstContext | null;
  influencers: InfluencerSuggestion[];
}

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/* ----------------------------- Instagram I/O ----------------------------- */

interface IgPost { id: string; handle: string; takenMs: number; views: number; likes: number; comments: number; caption: string; url: string; isPaid: boolean; }

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
  env?: Record<string, string | undefined>;
}): Promise<BurstInfluencerResult> {
  const env = opts.env ?? process.env;
  const emit = opts.emit;
  const none: BurstInfluencerResult = { burst: null, influencers: [] };

  const keepaKey = env.KEEPA_API_KEY?.trim();
  const scKey = env.SCRAPECREATORS_API_KEY?.trim();
  if (!keepaKey || !scKey) { emit("Missing Keepa/ScrapeCreators key — can't run burst attribution."); return none; }

  const competitors = (opts.brand.competitors.length ? opts.brand.competitors : []).slice(0, opts.maxCompetitors ?? 3);
  if (competitors.length === 0) { emit("No competitors identified — can't analyze competitor products."); return none; }

  const keepa = createKeepaAdapter(keepaKey, 1);
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
        const title = norm.products.find((p) => p.externalId === asin)?.title ?? asin;
        for (const s of res.spikes) {
          if (s.gate !== "passed") continue;
          const ms = Date.parse(`${s.date}T00:00:00Z`);
          if (ms < cutoff) continue;
          const strength = s.rankFrom - s.rankTo;
          if (!best || strength > best.strength) best = { competitor, asin, productTitle: title, date: s.date, rankFrom: s.rankFrom, rankTo: s.rankTo, z: s.z, strength };
        }
      }
    } catch (e) { emit(`(${competitor}: ${(e as Error).message ?? "skipped"})`); }
  }

  if (!best) { emit("No steady-price competitor burst in the last year — nothing to attribute."); return none; }
  const D = Date.parse(`${best.date}T00:00:00Z`);
  emit(`Biggest mover: ${best.competitor}'s "${best.productTitle.slice(0, 48)}" — Amazon #${best.rankFrom}→#${best.rankTo} on ${best.date} (price held). Looking for the creators behind it…`);

  // 2) REAL brand content: the AUTHENTICATED Instagram TAGGED feed — genuine
  //    posts that tagged the competitor brand (no hashtag-name ambiguity).
  //    Falls back to hashtag search only if the tagged feed is empty/sparse.
  const lo = D - 7 * DAY, hi = D + DAY;
  let inWindow: IgPost[] = [];

  const resolved = await resolveBrandHandle(best.competitor, env);
  if (resolved) {
    emit(`Pulling @${resolved.handle}'s Instagram tagged posts back to ${best.date}…`);
    const tagged = await fetchTaggedFeed(resolved.pk, lo, opts.taggedPages ?? 15, env);
    inWindow = tagged.filter((p) => p.takenMs >= lo && p.takenMs <= hi);
    emit(`${tagged.length} tagged post(s) scanned · ${inWindow.length} in the 7-day pre-burst window.`);
  } else {
    emit(`Couldn't resolve ${best.competitor}'s Instagram handle.`);
  }

  // Fallback: hashtag search + window filter when the tagged feed yields nothing.
  if (inWindow.length === 0 && scKey) {
    const seedTag = slugify(best.competitor).replace(/-/g, "");
    emit(`Tagged feed thin — falling back to #${seedTag} search…`);
    const mined = await mineHashtags(scKey, seedTag);
    const tags = [seedTag, ...mined.filter((t) => t.includes(seedTag) || seedTag.includes(t)).filter((t) => t !== seedTag)].slice(0, 3);
    const posts = await collectIg(scKey, tags, opts.igPagesPerTag ?? 15, emit);
    inWindow = posts.filter((p) => p.takenMs >= lo && p.takenMs <= hi);
  }

  if (inWindow.length === 0) {
    emit(`No in-window Instagram posts about ${best.competitor} — can't name the creators this time.`);
    return { burst: best, influencers: [] };
  }

  // 3) rank by engagement → top 3 distinct creators
  const bestPerHandle = new Map<string, IgPost>();
  for (const p of inWindow.sort((a, b) => engagement(b) - engagement(a))) {
    if (!bestPerHandle.has(p.handle)) bestPerHandle.set(p.handle, p);
  }
  const top = [...bestPerHandle.values()].slice(0, 3);
  emit(`${inWindow.length} in-window post(s); top creators: ${top.map((t) => "@" + t.handle).join(", ")}. Enriching profiles…`);

  const influencers: InfluencerSuggestion[] = [];
  for (const p of top) {
    const i = influencers.length;
    const prof = await resolveInstagramProfile(p.handle).catch(() => null);
    const daysBefore = Math.max(0, Math.round((D - p.takenMs) / DAY));
    const metric = p.views > 0 ? `${p.views.toLocaleString()} views` : `${p.likes.toLocaleString()} likes`;
    influencers.push({
      handle: p.handle,
      platform: "instagram",
      pk: prof?.pk,
      followers: prof?.followers ?? undefined,
      score: Math.round((0.95 - i * 0.06) * 100) / 100,
      rationale: `Posted about ${best.competitor} (${metric}) ${daysBefore}d before its Amazon rank jumped #${best.rankFrom}→#${best.rankTo}${p.isPaid ? " · paid partnership" : ""}.`,
    });
  }
  return { burst: best, influencers };
}
