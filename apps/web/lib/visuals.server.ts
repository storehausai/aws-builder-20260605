import { resolveInstagramProfile } from "@pebble/providers";
import { getBrandProfile } from "@/lib/brand.server";
import type { InfluencerSuggestion } from "@/lib/types";

/**
 * Visual data for the chat's research canvas — real images + a real chart:
 *   • brand + competitor LOGOS  (Clearbit, proxied through /api/img)
 *   • the BSR spike CHART        (real series from the engine)
 *   • creator AVATARS            (real Instagram profile pics, proxied)
 * Everything is best-effort: any piece that can't be resolved is simply omitted
 * and the UI falls back to a monogram. Never throws.
 */
export interface Visuals {
  brand?: { name: string; category?: string; logo?: string };
  competitors?: { name: string; logo?: string }[];
  chart?: { points: { date: string; rank: number; spike: boolean }[]; productTitle?: string } | null;
  creators?: { handle: string; avatar?: string; followers?: number; verified?: boolean; score?: number; rationale?: string }[];
}

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:8787";

const proxy = (url?: string): string | undefined => (url ? `/api/img?u=${encodeURIComponent(url)}` : undefined);

/** Brand mark via Google's favicon service (reliable; real domain only). */
function faviconFor(urlOrDomain: string): string {
  const domain = urlOrDomain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]!;
  return `/api/img?u=${encodeURIComponent(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`)}`;
}

async function engineChart(brandName: string): Promise<Visuals["chart"]> {
  try {
    const res = await fetch(`${ENGINE_URL}/market-movers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "brand", identifier: brandName }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      series?: { dates: string[]; ranks: number[] };
      spikeDates?: string[];
      productTitle?: string;
      error?: string;
    };
    if (d.error || !d.series?.dates?.length) return null;
    const spikes = new Set(d.spikeDates ?? []);
    const points = d.series.dates.map((date, i) => ({
      date,
      rank: d.series!.ranks[i] ?? 0,
      spike: spikes.has(date),
    }));
    return { points, productTitle: d.productTitle };
  } catch {
    return null;
  }
}

interface ResolvedProfile {
  profilePicUrl?: string;
  followers?: number;
  fullName?: string;
  isVerified?: boolean;
  exists: boolean;
}

// Session cache so repeat discoveries don't re-spend ScrapeCreators credits or
// re-hit the rate-limited free endpoint for the same handle.
const profileCache = new Map<string, ResolvedProfile>();

/** ScrapeCreators IG profile (paid key, no rate limit) — the reliable source. */
async function scProfile(handle: string): Promise<ResolvedProfile | null> {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://api.scrapecreators.com/v1/instagram/profile?handle=${encodeURIComponent(handle)}`,
      { headers: { "x-api-key": key }, signal: AbortSignal.timeout(12000) },
    );
    if (!res.ok) return null;
    const d = (await res.json()) as { success?: boolean; data?: { user?: Record<string, unknown> } };
    const u = d.data?.user;
    if (!d.success || !u) return null;
    const pic = (u.profile_pic_url_hd as string) || (u.profile_pic_url as string) || undefined;
    return {
      profilePicUrl: pic,
      followers: (u.edge_followed_by as { count?: number })?.count ?? (u.follower_count as number),
      fullName: u.full_name as string,
      isVerified: u.is_verified as boolean,
      exists: true,
    };
  } catch {
    return null;
  }
}

/** Resolve a creator's profile: free endpoint first (cheap), ScrapeCreators next
 *  (reliable). Cached per handle. */
async function resolveProfile(handle: string): Promise<ResolvedProfile> {
  const k = handle.toLowerCase().replace(/^@/, "");
  const cached = profileCache.get(k);
  if (cached) return cached;

  let out: ResolvedProfile = { exists: false };
  try {
    const free = await resolveInstagramProfile(handle);
    if (free?.profilePicUrl) {
      out = {
        profilePicUrl: free.profilePicUrl,
        followers: free.followers,
        fullName: free.fullName,
        isVerified: free.isVerified,
        exists: true,
      };
    }
  } catch {
    /* try SC next */
  }
  if (!out.profilePicUrl) {
    const sc = await scProfile(handle);
    if (sc) out = sc;
  }
  profileCache.set(k, out);
  return out;
}

/** Resolve a real Instagram avatar for each top creator (bounded + parallel).
 *  Prefers real, resolvable handles so a profile image shows everywhere. */
async function creatorAvatars(influencers: InfluencerSuggestion[]): Promise<Visuals["creators"]> {
  const enriched = await Promise.all(
    influencers.slice(0, 8).map(async (inf) => {
      const p = await resolveProfile(inf.handle);
      return {
        handle: inf.handle,
        avatar: proxy(p.profilePicUrl),
        followers: p.followers ?? inf.followers,
        verified: p.isVerified,
        score: inf.score,
        rationale: inf.rationale,
        exists: p.exists,
      };
    }),
  );
  // Prefer creators with a real photo; keep up to 6. If too few resolve, backfill
  // with the rest (monogram) so the list is never empty.
  const withPic = enriched.filter((c) => c.avatar);
  const list = (withPic.length >= 3 ? withPic : enriched).slice(0, 6);
  return list.map(({ exists: _exists, ...c }) => c);
}

export async function buildVisuals(opts: {
  storeId?: string;
  brandUrl?: string;
  influencers: InfluencerSuggestion[];
}): Promise<Visuals> {
  const visuals: Visuals = {};

  // Brand + competitors (from the persisted profile when we have a store).
  let brandName = "your brand";
  let category: string | undefined;
  let competitors: string[] = [];
  let domain = opts.brandUrl;
  if (opts.storeId) {
    try {
      const bp = await getBrandProfile(opts.storeId);
      if (bp) {
        brandName = bp.name || brandName;
        category = bp.category || undefined;
        competitors = Array.isArray(bp.competitors) ? bp.competitors : [];
        domain = bp.homepageUrl || domain;
      }
    } catch {
      /* ignore */
    }
  }
  visuals.brand = { name: brandName, category, logo: domain ? faviconFor(domain) : undefined };
  // Competitor domains are guessed → unreliable favicons; clean monograms instead.
  visuals.competitors = competitors.slice(0, 6).map((name) => ({ name }));

  // Chart + avatars in parallel.
  const [chart, creators] = await Promise.all([
    engineChart(brandName),
    creatorAvatars(opts.influencers),
  ]);
  visuals.chart = chart;
  visuals.creators = creators;

  return visuals;
}
