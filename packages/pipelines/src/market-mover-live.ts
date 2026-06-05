/**
 * market-mover-live — the a–h discovery core, run LIVE against Keepa.
 *
 * This is what makes demo step 3 real instead of fixture-backed: during the
 * workflow the agent actually pulls competitor BSR from Keepa, persists it to
 * Butterbase (the canonical cache), and runs the PURE engine math on it:
 *
 *   (b) competitor brand → Keepa Product Finder → ASINs
 *   (c) ASINs            → Keepa /product history → daily rank + price
 *       ↳ persisted to Butterbase via the IngestionWriter (cache + datastore)
 *   (d) detect ranking bursts                    ┐ findMarketMovers (pure engine)
 *   (e) price gate — was the price steady?       │ — same math the HTTP engine
 *   (f) burst + steady price ⇒ outside traffic   │   uses, fed live data here
 *   (g) creator content 0–7 days before a burst  │   (best-effort via providers)
 *   (h) most viral in-window post = market mover ┘
 *
 * Returns the strongest market mover found across all scanned competitors, plus
 * the aggregate burst counts used to narrate the chat. NEVER throws — every
 * brand/product is independently fault-tolerant so the chain always continues.
 */
import {
  createKeepaAdapter,
  createScrapeCreatorsAdapter,
  type BrandOnboarding,
} from "@pebble/providers";
import { findMarketMovers } from "@pebble/engine";
import { createBb, createIngestionWriter } from "@pebble/bb";
import type {
  CreatorMention,
  DateString,
  MarketMoverInput,
  MarketMoverResult,
  NormalizedMention,
  NormalizedProductPoint,
} from "@pebble/core";

/** The headline finding: the creator who actually moved a competitor's rank. */
export interface LiveMover {
  handle: string;
  followers?: number | null;
  sigma?: number;
  evidence: string;
  productTitle?: string;
  brand?: string;
}

export interface LiveResult {
  mover: LiveMover | null;
  brandsScanned: string[];
  productsScanned: number;
  burstsTotal: number;
  /** bursts that held a steady price (passed the discount gate). */
  burstsSteady: number;
  attributedCount: number;
}

export interface LiveOptions {
  brand: BrandOnboarding;
  emit: (s: string) => void;
  /** how many competitor brands to scan (token-bounded). Default 3. */
  maxBrands?: number;
  /** ASINs per brand to pull history for. Default 8. */
  maxAsinsPerBrand?: number;
  env?: Record<string, string | undefined>;
}

const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** NormalizedMention (provider) → CreatorMention (engine input). */
function toCreatorMention(m: NormalizedMention): CreatorMention {
  return {
    creatorHandle: m.creatorHandle,
    platform: m.platform,
    postedAt: m.postedAt ?? "",
    followers: m.creatorFollowers ?? null,
    views: m.views ?? null,
    likes: m.likes ?? null,
    comments: m.comments ?? null,
    url: m.externalUrl ?? null,
    coverUrl: m.coverUrl ?? null,
  };
}

/**
 * One product's daily points → the engine's RankPriceSeries. Ranks are
 * forward-filled to a continuous number[] (the engine's detectSpikes contract);
 * prices stay null where unknown so the price gate can tell "no data" from "flat".
 */
function pointsToSeries(points: NormalizedProductPoint[]): {
  dates: DateString[];
  ranks: number[];
  prices: Array<number | null>;
} {
  const sorted = [...points].sort((a, b) => (a.snapshotDate < b.snapshotDate ? -1 : 1));
  const dates: DateString[] = [];
  const ranks: number[] = [];
  const prices: Array<number | null> = [];
  let last = 0;
  for (const p of sorted) {
    if (p.rank != null) last = p.rank;
    dates.push(p.snapshotDate);
    ranks.push(p.rank ?? last);
    prices.push(p.price ?? null);
  }
  return { dates, ranks, prices };
}

/** Best-effort: pull creator content for a brand (for spike attribution). */
async function fetchContent(
  brand: string,
  env: Record<string, string | undefined>,
): Promise<{ content: CreatorMention[]; mentions: NormalizedMention[] }> {
  const key = env.SCRAPECREATORS_API_KEY?.trim();
  if (!key) return { content: [], mentions: [] };
  try {
    const sc = createScrapeCreatorsAdapter(key);
    // ScrapeCreators verified path is TikTok keyword search. A creator who moved
    // a competitor's Amazon rank often posted on TikTok; the engine windows
    // these against each spike, so cross-platform content still attributes.
    const raw = await sc.searchMentions({ brand, platform: "tiktok", maxPages: 1 });
    const mentions = sc.normalizeMentions(raw);
    return { content: mentions.map(toCreatorMention), mentions };
  } catch {
    return { content: [], mentions: [] };
  }
}

/** Choose competitor brands to scan: competitors first, else the brand itself. */
function targetBrands(brand: BrandOnboarding, cap: number): string[] {
  const list = brand.competitors.length ? brand.competitors : [brand.brand];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of list) {
    const t = b.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

export async function findMarketMoverLive(opts: LiveOptions): Promise<LiveResult> {
  const env = opts.env ?? process.env;
  const emit = opts.emit;
  const maxBrands = opts.maxBrands ?? 3;
  const maxAsins = opts.maxAsinsPerBrand ?? 8;

  const empty: LiveResult = {
    mover: null,
    brandsScanned: [],
    productsScanned: 0,
    burstsTotal: 0,
    burstsSteady: 0,
    attributedCount: 0,
  };

  const keepaKey = env.KEEPA_API_KEY?.trim();
  if (!keepaKey) {
    emit("No Keepa key configured — can't pull live Amazon data; using category signal.");
    return empty;
  }

  const keepa = createKeepaAdapter(keepaKey, 1); // domain 1 = amazon.com
  let writer: ReturnType<typeof createIngestionWriter> | null = null;
  try {
    writer = createIngestionWriter(createBb());
  } catch {
    writer = null; // Butterbase not configured → analyze in-process only, no cache
  }

  const brands = targetBrands(opts.brand, maxBrands);
  const results: Array<{ brand: string; res: MarketMoverResult }> = [];
  const brandsScanned: string[] = [];
  let productsScanned = 0;

  for (const b of brands) {
    try {
      emit(`Looking up ${b}'s products on Amazon…`);
      const found = await keepa.resolveBrand(b, maxAsins);
      const asins = found.map((f) => f.asin).slice(0, maxAsins);
      if (asins.length === 0) {
        emit(`No Amazon products found for ${b}.`);
        continue;
      }
      emit(`Found ${asins.length} ${b} product(s); pulling BSR + price history…`);
      const raw = await keepa.getProductsHistory(asins);
      const normalized = keepa.normalizeProductHistory(raw);
      brandsScanned.push(b);

      // Persist to Butterbase (cache + the canonical datastore). Best-effort.
      if (writer) {
        await writer
          .upsertCommerce(normalized, "keepa", { slug: slugify(b), name: b })
          .catch(() => undefined);
      }

      // (g) creator content for attribution — best-effort, persisted too.
      const { content, mentions } = await fetchContent(b, env);
      if (writer && mentions.length) {
        await writer
          .upsertMentions(slugify(b), mentions, "scrapecreators")
          .catch(() => undefined);
      }

      // (d–h) run the pure engine per product on the live series.
      const byAsin = new Map<string, NormalizedProductPoint[]>();
      for (const pt of normalized.points) {
        const arr = byAsin.get(pt.externalId) ?? [];
        arr.push(pt);
        byAsin.set(pt.externalId, arr);
      }
      for (const [asin, pts] of byAsin) {
        if (pts.length < 8) continue; // too short to detect a burst meaningfully
        productsScanned += 1;
        const title = normalized.products.find((p) => p.externalId === asin)?.title ?? undefined;
        const input: MarketMoverInput = {
          product: { asin, title: title ?? undefined },
          series: pointsToSeries(pts),
          content,
        };
        results.push({ brand: b, res: findMarketMovers(input) });
      }
    } catch (e) {
      emit(`(${b}: ${(e as Error).message ?? "skipped"})`);
    }
  }

  // Aggregate the burst metrics for narration.
  let burstsTotal = 0;
  let burstsSteady = 0;
  let attributedCount = 0;
  for (const { res } of results) {
    burstsTotal += res.spikes.length;
    burstsSteady += res.spikes.filter((s) => s.gate === "passed").length;
    attributedCount += res.attributed.length;
  }

  // (h) the headline mover = the strongest attribution across everything.
  let best: { brand: string; res: MarketMoverResult } | null = null;
  for (const r of results) {
    if (!r.res.topAttribution) continue;
    if (!best?.res.topAttribution) {
      best = r;
      continue;
    }
    if (
      r.res.topAttribution.creator.compositeSigma >
      best.res.topAttribution.creator.compositeSigma
    ) {
      best = r;
    }
  }

  let mover: LiveMover | null = null;
  if (best?.res.topAttribution) {
    const c = best.res.topAttribution.creator;
    mover = {
      handle: c.handle,
      followers: c.followers,
      sigma: c.compositeSigma,
      evidence: "drove a real, flat-price Amazon rank burst for a competitor",
      productTitle: best.res.productTitle,
      brand: best.brand,
    };
  }

  return {
    mover,
    brandsScanned,
    productsScanned,
    burstsTotal,
    burstsSteady,
    attributedCount,
  };
}
