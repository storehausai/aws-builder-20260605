/**
 * Similar-creator discovery — step (i) of the influencer-discovery flow.
 *
 * Once the engine has identified the "market mover" creator who drove a
 * competitor's BSR burst (steps c–h, built elsewhere), this finds creators
 * SIMILAR to that mover so the brand can pitch lookalikes. Input is a niche
 * (derived from the mover's topics/category) plus optional platform / follower
 * band / seed handle; output is a lean list of `CreatorCandidate`s.
 *
 * The approach: apidojo search-by-keyword, per-platform budget split, dedupe by
 * handle, post-scrape follower filter. We do NOT score / rank / auto-drop — the
 * candidates are surfaced as data.
 *
 * Two paths, in priority order:
 *   PRIMARY (real data) — if APIFY_TOKEN is set, run the apidojo Instagram /
 *     TikTok scrapers over the niche (as a hashtag/keyword) and normalize each
 *     post's author into a candidate.
 *   FALLBACK (no key) — ask the Butterbase AI gateway to propose plausible US
 *     creators in the niche as strict JSON, then OPTIONALLY enrich Instagram
 *     handles with real follower counts via resolveInstagramProfile().
 *
 * Design rule: NEVER throw. Total failure returns []. US creators only.
 */

import { createBb, chatText } from "@pebble/bb";
import { resolveInstagramProfile } from "./instagram-public.js";

/* -------------------------------- types -------------------------------- */

export interface CreatorCandidate {
  handle: string;
  platform: "instagram" | "tiktok";
  followers?: number;
  bio?: string;
  topics?: string[];
  pk?: string; // IG numeric id when known
  profileUrl: string;
}

export interface SimilarCreatorQuery {
  niche: string; // derived from the market-mover creator's topics/category
  platform?: "instagram" | "tiktok";
  followerMin?: number;
  followerMax?: number;
  maxResults?: number; // default 10
  seedHandle?: string; // the market-mover creator to find lookalikes of
}

/* ------------------------------ constants ------------------------------ */

const TIKTOK_ACTOR_URL =
  "https://api.apify.com/v2/acts/apidojo~tiktok-scraper/run-sync-get-dataset-items";
const INSTAGRAM_ACTOR_URL =
  "https://api.apify.com/v2/acts/apidojo~instagram-scraper/run-sync-get-dataset-items";

/** Bound a single sync actor run so a slow scrape can't stall the request. */
const SCRAPE_TIMEOUT_MS = 240_000;

const DEFAULT_MAX_RESULTS = 10;

/* ------------------------------- helpers ------------------------------- */

/** Cap maxResults to a sane bounded positive integer (default 10). */
function boundedMax(max: number | undefined): number {
  if (typeof max !== "number" || !Number.isFinite(max) || max <= 0) {
    return DEFAULT_MAX_RESULTS;
  }
  return Math.min(Math.floor(max), 100);
}

/** Sanitize a niche to a valid IG/TikTok hashtag token (ascii word chars). */
function nicheToHashtag(niche: string): string {
  return niche.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

/** Non-empty trimmed string, or undefined (so optional fields stay absent). */
function strOrUndef(value: unknown): string | undefined {
  if (typeof value === "string") {
    const t = value.trim();
    return t === "" ? undefined : t;
  }
  return undefined;
}

/** Finite non-negative integer, or undefined. */
function numOrUndef(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return undefined;
}

/** Apply the optional follower band; candidates with unknown counts pass. */
function inFollowerBand(
  c: CreatorCandidate,
  min: number | undefined,
  max: number | undefined,
): boolean {
  if (c.followers == null) return true; // unknown count — don't drop
  if (min != null && c.followers < min) return false;
  if (max != null && c.followers > max) return false;
  return true;
}

/**
 * Dedupe by (platform, handle), drop the seed handle itself (we want
 * lookalikes, not the mover), apply the follower band, then cap to maxResults.
 */
function finalize(
  candidates: CreatorCandidate[],
  q: SimilarCreatorQuery,
): CreatorCandidate[] {
  const min = numOrUndef(q.followerMin);
  const max = numOrUndef(q.followerMax);
  const seed = q.seedHandle?.trim().replace(/^@+/, "").toLowerCase();
  const cap = boundedMax(q.maxResults);

  const seen = new Set<string>();
  const out: CreatorCandidate[] = [];
  for (const c of candidates) {
    const handle = c.handle.toLowerCase();
    if (seed && handle === seed) continue; // exclude the mover itself
    const key = `${c.platform}::${handle}`;
    if (seen.has(key)) continue;
    if (!inFollowerBand(c, min, max)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= cap) break;
  }
  return out;
}

/* ------------------------------ apify path ----------------------------- */

/** POST an apidojo actor input and return the dataset items array (or []). */
async function runActor(
  actorUrl: string,
  token: string,
  input: Record<string, unknown>,
): Promise<unknown[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
  try {
    const res = await fetch(`${actorUrl}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`apify ${res.status} ${res.statusText}`);
    }
    const data: unknown = await res.json();
    return Array.isArray(data) ? data : [];
  } finally {
    clearTimeout(timer);
  }
}

/** apidojo TikTok video item — only the authorMeta we read for candidates. */
interface ApidojoTikTokItem {
  authorMeta?: {
    name?: string; // handle
    nickName?: string; // display name (unused in lean shape)
    fans?: number; // follower count
    signature?: string; // bio
    profileUrl?: string;
  };
  text?: string; // caption — a topic signal
}

async function scrapeTikTok(
  token: string,
  niche: string,
  cap: number,
): Promise<CreatorCandidate[]> {
  // apidojo/tiktok-scraper takes `keywords`; each video's authorMeta is the
  // creator signal. Over-fetch (×3) so dedupe-by-author still yields `cap`.
  const items = (await runActor(TIKTOK_ACTOR_URL, token, {
    keywords: [niche],
    resultsPerPage: Math.max(20, cap * 3),
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
  })) as ApidojoTikTokItem[];

  const byHandle = new Map<string, CreatorCandidate>();
  for (const item of items) {
    const author = item.authorMeta;
    const handle = strOrUndef(author?.name)?.toLowerCase();
    if (!handle) continue;

    const topic = item.text ? item.text.slice(0, 140) : undefined;
    const existing = byHandle.get(handle);
    if (existing) {
      if (topic && existing.topics && !existing.topics.includes(topic)) {
        existing.topics.push(topic);
      }
      continue;
    }

    const candidate: CreatorCandidate = {
      handle,
      platform: "tiktok",
      profileUrl:
        strOrUndef(author?.profileUrl) ?? `https://www.tiktok.com/@${handle}`,
    };
    const followers = numOrUndef(author?.fans);
    if (followers != null) candidate.followers = followers;
    const bio = strOrUndef(author?.signature);
    if (bio) candidate.bio = bio;
    if (topic) candidate.topics = [topic];
    byHandle.set(handle, candidate);
  }
  return Array.from(byHandle.values());
}

/** apidojo Instagram item — only the owner block we read for candidates. */
interface ApidojoInstagramItem {
  caption?: string;
  owner?: {
    id?: string | number;
    username?: string;
    fullName?: string;
    biography?: string;
    followersCount?: number;
    followerCount?: number; // apidojo has used both spellings — tolerate either
  };
}

async function scrapeInstagram(
  token: string,
  niche: string,
  cap: number,
): Promise<CreatorCandidate[]> {
  // apidojo/instagram-scraper needs `startUrls`; we hit the hashtag explore
  // page and read each post's owner block. Sanitize the niche to a valid tag.
  const tag = nicheToHashtag(niche);
  if (!tag) return [];
  const items = (await runActor(INSTAGRAM_ACTOR_URL, token, {
    startUrls: [{ url: `https://www.instagram.com/explore/tags/${tag}/` }],
    resultsLimit: Math.max(20, cap * 3),
  })) as ApidojoInstagramItem[];

  const byHandle = new Map<string, CreatorCandidate>();
  for (const item of items) {
    const owner = item.owner;
    const handle = strOrUndef(owner?.username)?.toLowerCase();
    if (!handle) continue;

    const topic = item.caption ? item.caption.slice(0, 140) : undefined;
    const existing = byHandle.get(handle);
    if (existing) {
      if (topic && existing.topics && !existing.topics.includes(topic)) {
        existing.topics.push(topic);
      }
      continue;
    }

    const candidate: CreatorCandidate = {
      handle,
      platform: "instagram",
      profileUrl: `https://www.instagram.com/${handle}/`,
    };
    const followers =
      numOrUndef(owner?.followersCount) ?? numOrUndef(owner?.followerCount);
    if (followers != null) candidate.followers = followers;
    const bio = strOrUndef(owner?.biography);
    if (bio) candidate.bio = bio;
    const pk =
      typeof owner?.id === "number"
        ? String(owner.id)
        : strOrUndef(owner?.id);
    if (pk) candidate.pk = pk;
    if (topic) candidate.topics = [topic];
    byHandle.set(handle, candidate);
  }
  return Array.from(byHandle.values());
}

/**
 * Run the apidojo path across the requested platform(s). Each actor is wrapped
 * so one failing doesn't sink the other; total failure returns [].
 */
async function discoverViaApify(
  token: string,
  q: SimilarCreatorQuery,
): Promise<CreatorCandidate[]> {
  const cap = boundedMax(q.maxResults);
  const wantInstagram = q.platform == null || q.platform === "instagram";
  const wantTikTok = q.platform == null || q.platform === "tiktok";
  // Split the over-fetch budget when both platforms are in play.
  const perPlatform =
    wantInstagram && wantTikTok ? Math.ceil(cap / 2) : cap;

  const empty: CreatorCandidate[] = [];
  const [igResults, ttResults] = await Promise.all([
    wantInstagram
      ? scrapeInstagram(token, q.niche, perPlatform).catch(() => empty)
      : Promise.resolve(empty),
    wantTikTok
      ? scrapeTikTok(token, q.niche, perPlatform).catch(() => empty)
      : Promise.resolve(empty),
  ]);

  return [...igResults, ...ttResults];
}

/* --------------------------- AI fallback path -------------------------- */

interface AiCreator {
  handle: string;
  platform: "instagram" | "tiktok";
  followers?: number;
  bio?: string;
  topics?: string[];
}

/** Pull the first JSON array out of a model reply, tolerating fences/prose. */
function extractJsonArray(text: string): unknown[] {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  // The model may return either a bare array or an object wrapping `creators`.
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  let parsed = tryParse(unfenced);
  if (parsed == null) {
    const start = unfenced.indexOf("[");
    const end = unfenced.lastIndexOf("]");
    if (start !== -1 && end > start) {
      parsed = tryParse(unfenced.slice(start, end + 1));
    }
  }
  if (Array.isArray(parsed)) return parsed;
  if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { creators?: unknown }).creators)
  ) {
    return (parsed as { creators: unknown[] }).creators;
  }
  return [];
}

function buildAiSystem(): string {
  return (
    "You are a US influencer-marketing analyst. Propose plausible, real US " +
    "social creators in a given niche so a brand can find lookalikes of a " +
    "market-mover creator. US creators only — never non-US / Korean accounts. " +
    "Respond with STRICT JSON ONLY (no prose, no markdown fences): an array of " +
    'objects shaped {"handle": string, "platform": "instagram"|"tiktok", ' +
    '"followers"?: number, "bio"?: string, "topics"?: string[]}. Handles must ' +
    "be plain usernames without a leading @. Prefer mid-tier creators."
  );
}

/** Map a loosely-typed AI creator object into a CreatorCandidate, or null. */
function aiToCandidate(raw: unknown): CreatorCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const handle = strOrUndef(obj.handle)?.replace(/^@+/, "").toLowerCase();
  if (!handle) return null;
  const platform: "instagram" | "tiktok" =
    obj.platform === "tiktok" ? "tiktok" : "instagram";
  const candidate: CreatorCandidate = {
    handle,
    platform,
    profileUrl:
      platform === "tiktok"
        ? `https://www.tiktok.com/@${handle}`
        : `https://www.instagram.com/${handle}/`,
  };
  const followers = numOrUndef(obj.followers);
  if (followers != null) candidate.followers = followers;
  const bio = strOrUndef(obj.bio);
  if (bio) candidate.bio = bio;
  if (Array.isArray(obj.topics)) {
    const topics = obj.topics
      .map((t) => strOrUndef(t))
      .filter((t): t is string => t != null);
    if (topics.length > 0) candidate.topics = topics;
  }
  return candidate;
}

/**
 * Enrich Instagram candidates with real follower counts + pk via the public
 * profile resolver. Best-effort and bounded; a failed lookup leaves the
 * candidate unchanged. TikTok candidates are left as-is (no public resolver).
 */
async function enrichInstagram(
  candidates: CreatorCandidate[],
): Promise<CreatorCandidate[]> {
  await Promise.all(
    candidates.map(async (c) => {
      if (c.platform !== "instagram") return;
      try {
        const profile = await resolveInstagramProfile(c.handle);
        if (!profile) return;
        c.pk = profile.pk;
        if (typeof profile.followers === "number") {
          c.followers = profile.followers;
        }
        if (!c.bio && profile.biography) c.bio = profile.biography;
      } catch {
        // Resolver hiccup — keep the model's best-guess candidate as-is.
      }
    }),
  );
  return candidates;
}

/**
 * AI fallback: propose US creators in the niche, then enrich IG handles with
 * real follower counts. Returns [] on any failure (no bb config, AI error,
 * unparseable reply).
 */
async function discoverViaAi(
  q: SimilarCreatorQuery,
): Promise<CreatorCandidate[]> {
  let bb: ReturnType<typeof createBb>;
  try {
    bb = createBb();
  } catch {
    return [];
  }

  const cap = boundedMax(q.maxResults);
  const platformLine =
    q.platform == null
      ? "instagram and/or tiktok"
      : q.platform;
  const bandLine =
    q.followerMin != null || q.followerMax != null
      ? `Target follower range: ${q.followerMin ?? 0} to ${q.followerMax ?? "any"}.`
      : "";
  const seedLine = q.seedHandle
    ? `Find creators SIMILAR to the market-mover @${q.seedHandle.replace(/^@+/, "")} (do NOT include that account itself).`
    : "";
  const user = [
    `Niche: ${q.niche}`,
    `Platform: ${platformLine}`,
    `Return up to ${cap} creators.`,
    bandLine,
    seedLine,
  ]
    .filter(Boolean)
    .join("\n");

  let reply: string;
  try {
    reply = await chatText(bb, buildAiSystem(), user);
  } catch {
    return [];
  }

  const rows = extractJsonArray(reply);
  const candidates: CreatorCandidate[] = [];
  for (const row of rows) {
    const c = aiToCandidate(row);
    if (c) candidates.push(c);
  }
  if (candidates.length === 0) return [];

  // Best-effort enrichment of IG handles with real follower data.
  return enrichInstagram(candidates);
}

/* ------------------------------- public -------------------------------- */

/**
 * Discover creators similar to a market mover, in the given niche.
 *
 * PRIMARY path uses the apidojo Instagram/TikTok scrapers when APIFY_TOKEN is
 * set; otherwise FALLS BACK to the Butterbase AI gateway (optionally enriched
 * with real Instagram follower counts). NEVER throws — returns [] on total
 * failure. US creators only.
 *
 * @param q the niche + optional platform / follower band / seed handle.
 */
export async function discoverSimilarCreators(
  q: SimilarCreatorQuery,
): Promise<CreatorCandidate[]> {
  if (!q || typeof q.niche !== "string" || q.niche.trim() === "") {
    return [];
  }

  const token = process.env.APIFY_TOKEN?.trim();

  let candidates: CreatorCandidate[] = [];
  if (token) {
    try {
      candidates = await discoverViaApify(token, q);
    } catch {
      candidates = [];
    }
    // If apidojo came back empty (e.g. a thin hashtag), fall back to the AI
    // path so the step still returns something useful.
    if (candidates.length === 0) {
      try {
        candidates = await discoverViaAi(q);
      } catch {
        candidates = [];
      }
    }
  } else {
    try {
      candidates = await discoverViaAi(q);
    } catch {
      candidates = [];
    }
  }

  return finalize(candidates, q);
}
