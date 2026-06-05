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
  creators?: { handle: string; avatar?: string; followers?: number; score?: number; rationale?: string }[];
}

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:8787";

const proxy = (url?: string): string | undefined => (url ? `/api/img?u=${encodeURIComponent(url)}` : undefined);

/** Clearbit logo by domain (real brand marks); proxied to dodge CORS/hotlink. */
function logoFor(domainOrName: string): string {
  const domain = /\./.test(domainOrName)
    ? domainOrName.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]!
    : `${domainOrName.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`;
  return `/api/img?u=${encodeURIComponent(`https://logo.clearbit.com/${domain}?size=128`)}`;
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

/** Resolve a real Instagram avatar for each top creator (bounded + parallel). */
async function creatorAvatars(
  influencers: InfluencerSuggestion[],
): Promise<Visuals["creators"]> {
  const top = influencers.slice(0, 6);
  return Promise.all(
    top.map(async (inf) => {
      let avatar: string | undefined;
      try {
        const p = await resolveInstagramProfile(inf.handle);
        avatar = proxy(p?.profilePicUrl);
        if (p?.followers && !inf.followers) inf.followers = p.followers;
      } catch {
        /* fall back to monogram */
      }
      return {
        handle: inf.handle,
        avatar,
        followers: inf.followers,
        score: inf.score,
        rationale: inf.rationale,
      };
    }),
  );
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
  visuals.brand = { name: brandName, category, logo: domain ? logoFor(domain) : undefined };
  visuals.competitors = competitors.slice(0, 6).map((name) => ({ name, logo: logoFor(name) }));

  // Chart + avatars in parallel.
  const [chart, creators] = await Promise.all([
    engineChart(brandName),
    creatorAvatars(opts.influencers),
  ]);
  visuals.chart = chart;
  visuals.creators = creators;

  return visuals;
}
