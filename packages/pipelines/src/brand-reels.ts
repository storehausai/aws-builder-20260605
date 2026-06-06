/**
 * brand-reels — simple, Apify-only influencer discovery.
 *
 *   1. Pick the RIGHT brand hashtag(s) from the onboarded brand name.
 *   2. ONE cheap apidojo `instagram-scraper` listing per tag (maxItems ~50) —
 *      no deep pagination, no burst-window matching. Just enough reels to pick
 *      the virals.
 *   3. Rank by engagement, take the top distinct creators, then enrich just
 *      that handful with the official `apify~instagram-scraper` to get REAL
 *      view counts + video URLs + avatars (apidojo listings are lean).
 *   4. Return the top 6 creators of the most-viral brand reels.
 *
 * NO ScrapeCreators anywhere. NEVER throws — returns [] on total failure.
 */
import type { BrandOnboarding } from "@pebble/providers";
import type { InfluencerSuggestion } from "./types.js";

const APIFY_BASE = "https://api.apify.com/v2/acts";
const APIDOJO_IG = "apidojo~instagram-scraper";
const OFFICIAL_IG = "apify~instagram-scraper";
const ACTOR_TIMEOUT_MS = 180_000;

/** Lean reel collected from the apidojo listing, enriched in place later. */
interface Reel {
  id: string; // shortcode (stable post key)
  handle: string;
  caption: string;
  url: string;
  likes: number;
  views: number; // 0 until official enrichment fills it
  isVideo: boolean;
  thumbnailUrl?: string;
  videoUrl?: string;
  avatarUrl?: string;
  pk?: string;
  followers?: number;
}

/* ------------------------------- helpers -------------------------------- */

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const shortcode = (url: string): string | null =>
  url.match(/\/(?:p|reel|tv)\/([^/?#]+)/i)?.[1] ?? null;
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const str = (v: unknown): string | undefined => {
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
};

// Common DTC domain affixes — strip so "getrael"/"shopglossier"/"drinkolipop"
// resolve to the REAL brand tag (#rael, #glossier, #olipop) instead of the
// domain-shaped noise tag. Order: longest-first isn't needed (single pass).
const BRAND_PREFIXES = ["get", "shop", "try", "buy", "the", "go", "join", "use", "my", "hey", "drink", "eat", "wear"];
const BRAND_SUFFIXES = ["official", "store", "shop", "beauty", "care", "cosmetics", "hq", "co", "app", "inc"];

/** Strip a leading/trailing DTC affix from a slug (e.g. getrael → rael). */
function deAffix(s: string): string {
  let out = s;
  for (const p of BRAND_PREFIXES) {
    if (out.length > p.length + 2 && out.startsWith(p)) { out = out.slice(p.length); break; }
  }
  for (const suf of BRAND_SUFFIXES) {
    if (out.length > suf.length + 2 && out.endsWith(suf)) { out = out.slice(0, -suf.length); break; }
  }
  return out;
}

// Categories that map to a beauty/skincare disambiguation suffix. A bare brand
// tag like "#rael" is ambiguous (Rael is also a Brazilian rapper), so for
// beauty brands we ALSO try "{brand}beauty"/"{brand}skincare" which almost
// always resolve to the real brand's content.
const BEAUTY_HINT = /beaut|skin|cosmet|makeup|make[- ]?up|glow|serum|lash|hair|nail|fragrance|perfume|care/i;

/** A short category-disambiguation word for the brand+category combo tag. */
function categoryWord(category: string): string | undefined {
  const c = (category || "").toLowerCase();
  if (BEAUTY_HINT.test(c)) {
    if (/skin/.test(c)) return "skincare";
    if (/cosmet|makeup|make[- ]?up/.test(c)) return "cosmetics";
    return "beauty";
  }
  // Otherwise use the first alphabetic token of the category, if any.
  const word = c.match(/[a-z]{3,}/)?.[0];
  return word;
}

/**
 * Pick the right brand hashtag(s). The brand's own name is the cleanest,
 * least-ambiguous tag (unlike a common competitor name). We try the de-affixed
 * form FIRST (so a "get…"/"shop…" domain resolves to the real brand tag).
 *
 * Bare brand tags are often ambiguous (e.g. "#rael" → a Brazilian rapper, not
 * the skincare brand), so we ALSO add ONE brand+category variant
 * (e.g. "{brand}beauty"/"{brand}skincare") to disambiguate. Capped at 2 tags
 * (cost): [brand+category (specific, first), bareBrand].
 */
function brandHashtags(brand: BrandOnboarding): string[] {
  const bare: string[] = [];
  const add = (list: string[], raw: string) => {
    const t = slug(raw);
    if (t.length > 1 && !list.includes(t)) list.push(t);
  };
  const primary = slug(brand.brand || "");
  if (primary) { add(bare, deAffix(primary)); add(bare, primary); }
  let host = "";
  try {
    host = new URL(
      /^https?:\/\//i.test(brand.homepageUrl) ? brand.homepageUrl : `https://${brand.homepageUrl}`,
    ).hostname.replace(/^www\./, "").split(".")[0] || "";
    add(bare, deAffix(slug(host))); add(bare, slug(host));
  } catch {
    /* no usable host */
  }

  const baseBrand = bare[0]; // the de-affixed brand token (e.g. "rael")
  const cat = categoryWord(brand.category || "");
  // Build a specific brand+category tag when we have a category hint AND the
  // suffix isn't already baked into the brand token.
  const specific =
    baseBrand && cat && !baseBrand.includes(cat) ? slug(`${baseBrand}${cat}`) : undefined;

  // Order matters: try the SPECIFIC tag first (it's the disambiguated one),
  // then fall back to the bare brand tag. Cap at 2 to keep Apify cost low.
  const tags: string[] = [];
  if (specific) tags.push(specific);
  if (baseBrand && !tags.includes(baseBrand)) tags.push(baseBrand);
  return tags.slice(0, 2);
}


// Tier C cache: short-lived in-memory results keyed by the primary brand hashtag,
// so repeated discoveries of the same brand (e.g. while iterating/testing) don't
// re-spend Apify credits. Resets on server restart; default 30-min TTL.
const REEL_CACHE_TTL_MS = (Number(process.env.REEL_CACHE_MINUTES) || 30) * 60_000;
const reelCache = new Map<string, { at: number; influencers: InfluencerSuggestion[] }>();

/** POST an Apify actor's run-sync-get-dataset-items and return the items array. */
async function runActor(
  actor: string,
  token: string,
  input: Record<string, unknown>,
): Promise<unknown[]> {
  const url = `${APIFY_BASE}/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACTOR_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`apify ${actor} HTTP ${res.status}`);
    const data: unknown = await res.json();
    return Array.isArray(data) ? data : [];
  } finally {
    clearTimeout(timer);
  }
}

/** apidojo IG listing item → lean Reel (verified shape from ../storehaus). */
function mapApidojo(raw: unknown): Reel | null {
  if (!raw || typeof raw !== "object") return null;
  const it = raw as {
    url?: string;
    caption?: string;
    isVideo?: boolean;
    image?: { url?: string } | null;
    video?: { url?: string } | null;
    owner?: { username?: string; profilePicUrl?: string } | null;
    likeCount?: number;
  };
  const handle = str(it.owner?.username)?.toLowerCase();
  const url = str(it.url);
  if (!handle || !url) return null;
  return {
    id: shortcode(url) ?? url,
    handle,
    caption: (it.caption ?? "").slice(0, 140),
    url,
    likes: num(it.likeCount),
    views: 0,
    isVideo: Boolean(it.isVideo),
    thumbnailUrl: str(it.image?.url),
    videoUrl: str(it.video?.url),
    avatarUrl: str(it.owner?.profilePicUrl),
  };
}

/**
 * Enrich a shortlist of reels with REAL views + video URL (official post
 * detail) and avatar + follower count + pk (official profile detail). Mutates
 * the reels in place. Best-effort — a failed call just leaves fields as-is.
 */
async function enrich(reels: Reel[], token: string): Promise<void> {
  if (!reels.length) return;
  const postUrls = reels.map((r) => r.url);
  const handles = [...new Set(reels.map((r) => r.handle))];

  const [postItems, profItems] = await Promise.all([
    runActor(OFFICIAL_IG, token, { directUrls: postUrls, resultsType: "posts", resultsLimit: 1 }).catch(() => [] as unknown[]),
    runActor(OFFICIAL_IG, token, {
      directUrls: handles.map((h) => `https://www.instagram.com/${h}/`),
      resultsType: "details",
      resultsLimit: 1,
    }).catch(() => [] as unknown[]),
  ]);

  // shortcode → { views, video }
  const byCode = new Map<string, { views: number; videoUrl?: string }>();
  for (const raw of postItems) {
    const it = raw as { url?: string; shortCode?: string; videoUrl?: string; videoViewCount?: number };
    const code = str(it.shortCode) ?? (str(it.url) ? shortcode(it.url!) : null);
    if (code) byCode.set(code, { views: num(it.videoViewCount), videoUrl: str(it.videoUrl) });
  }
  // handle → { avatar, followers, pk }
  const byHandle = new Map<string, { avatar?: string; followers?: number; pk?: string }>();
  for (const raw of profItems) {
    const it = raw as { username?: string; profilePicUrl?: string; followersCount?: number; id?: string | number };
    const h = str(it.username)?.toLowerCase();
    if (h) byHandle.set(h, { avatar: str(it.profilePicUrl), followers: num(it.followersCount) || undefined, pk: str(it.id) ?? (typeof it.id === "number" ? String(it.id) : undefined) });
  }

  for (const r of reels) {
    const code = shortcode(r.url);
    const post = code ? byCode.get(code) : undefined;
    if (post) {
      if (post.views > 0) r.views = post.views;
      if (post.videoUrl) r.videoUrl = post.videoUrl;
    }
    const prof = byHandle.get(r.handle);
    if (prof) {
      if (prof.avatar) r.avatarUrl = prof.avatar;
      if (prof.followers) r.followers = prof.followers;
      if (prof.pk) r.pk = prof.pk;
    }
  }
}

/** Virality score: real views when known, else a likes-based proxy. */
const viral = (r: Reel) => (r.views > 0 ? r.views : r.likes * 25);

/* -------------------------------- main ---------------------------------- */

export interface BrandReelResult {
  influencers: InfluencerSuggestion[];
}

export async function findBrandReelInfluencers(opts: {
  brand: BrandOnboarding;
  emit: (s: string) => void;
  listingItems?: number; // apidojo maxItems per tag (default 50)
  shortlist?: number; // creators to enrich before final top-6 (default 8)
  env?: Record<string, string | undefined>;
}): Promise<BrandReelResult> {
  const env = opts.env ?? process.env;
  const emit = opts.emit;
  const token = env.APIFY_TOKEN?.trim();
  if (!token) {
    emit("Apify not configured — can't search Instagram for brand reels.");
    return { influencers: [] };
  }

  const tags = brandHashtags(opts.brand);
  if (!tags.length) {
    emit("Couldn't derive a brand hashtag.");
    return { influencers: [] };
  }
  const brandName = opts.brand.brand || tags[0]!;

  // Tier C: serve a recent cached result for this hashtag — zero Apify spend.
  const cacheKey = tags[0]!;
  const cachedHit = reelCache.get(cacheKey);
  if (cachedHit && Date.now() - cachedHit.at < REEL_CACHE_TTL_MS && cachedHit.influencers.length) {
    emit(`Reusing ${cachedHit.influencers.length} cached creators for #${cacheKey} (no Apify spend).`);
    return { influencers: cachedHit.influencers };
  }

  emit(`Searching Instagram #${tags.join(", #")} for ${brandName} reels…`);

  // 1) One cheap apidojo listing per tag — no pagination. (Tier A: 30 items.)
  const maxItems = opts.listingItems ?? 30;
  const seen = new Set<string>();
  const reels: Reel[] = [];
  for (const tag of tags) {
    const items = await runActor(APIDOJO_IG, token, {
      startUrls: [`https://www.instagram.com/explore/tags/${tag}/`],
      maxItems,
    }).catch(() => [] as unknown[]);
    for (const raw of items) {
      const r = mapApidojo(raw);
      if (r && r.id && !seen.has(r.id)) { seen.add(r.id); reels.push(r); }
    }
  }
  if (!reels.length) {
    emit(`No Instagram reels found for ${brandName}.`);
    return { influencers: [] };
  }

  // 2) Relevance gate — bare brand tags can return off-brand junk (e.g. #rael
  //    pulls a Brazilian rapper's fan accounts). Prefer reels whose caption
  //    mentions the brand token; fall back to all reels only if that leaves
  //    too few to rank.
  const brandToken = (deAffix(slug(brandName)) || slug(brandName)).slice(0, 24);
  const onTopic = brandToken
    ? reels.filter((r) => r.caption.toLowerCase().includes(brandToken))
    : reels;
  const pool = onTopic.length >= 3 ? onTopic : reels;

  // 3) Top distinct creators by engagement (apidojo gives likes), then enrich
  //    just that shortlist with the official actor for REAL views/video/avatar.
  const bestPerHandle = new Map<string, Reel>();
  for (const r of [...pool].sort((a, b) => viral(b) - viral(a))) {
    if (!bestPerHandle.has(r.handle)) bestPerHandle.set(r.handle, r);
  }
  const shortlist = [...bestPerHandle.values()].slice(0, opts.shortlist ?? 6);
  emit(`Found ${reels.length} reels — enriching the top ${shortlist.length} with real view counts…`);
  await enrich(shortlist, token);

  // 4) Final ranking by real views (likes proxy when a view count is missing),
  //    take the top 6.
  const top = shortlist.sort((a, b) => viral(b) - viral(a)).slice(0, 6);
  emit(`Top ${brandName} reels by views: ${top.map((t) => "@" + t.handle).join(", ")}.`);

  const influencers: InfluencerSuggestion[] = top.map((r, i) => {
    const metric = r.views > 0 ? `${r.views.toLocaleString()} views` : `${r.likes.toLocaleString()} likes`;
    return {
      handle: r.handle,
      platform: "instagram",
      pk: r.pk,
      followers: r.followers,
      score: Math.round((0.95 - i * 0.06) * 100) / 100,
      rationale: `Top viral reel about ${brandName} — ${metric}.`,
      postUrl: r.url || undefined,
      thumbnailUrl: r.thumbnailUrl,
      videoUrl: r.videoUrl,
      avatarUrl: r.avatarUrl,
    };
  });

  // Tier C: cache this hashtag's result so repeat runs skip Apify entirely.
  if (influencers.length) reelCache.set(cacheKey, { at: Date.now(), influencers });
  return { influencers };
}
