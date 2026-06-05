/**
 * engine-data — read canonical data from Butterbase (@pebble/bb) and shape it
 * into the engine's MarketMoverInput, then run findMarketMovers.
 *
 * Ported from pebble's apps/web/lib/panel-data/marketMover.ts
 * (buildMarketMoverArtifactDb / buildSpikeContentArtifactDb), adapted from
 * Supabase to @pebble/bb's query builder. The big simplification vs pebble:
 * pebble assembles a multi-product *dashboard artifact* (its own SpikeMarker /
 * MarketMoverArtifact shapes). Here we feed the PURE engine its native
 * MarketMoverInput (one product series + dated content) and return the engine's
 * own MarketMoverResult verbatim — that's the contract RocketRide depends on.
 */

import { createBb, unwrap, unwrapMaybe, type Bb } from "@pebble/bb";
import { findMarketMovers } from "@pebble/engine";
import type {
  MarketMoverInput,
  MarketMoverResult,
  CreatorMention,
  Platform,
  DateString,
} from "@pebble/core";

export type MarketMoverScope = "brand" | "asin";

export interface MarketMoverRequest {
  scope: MarketMoverScope;
  /** brand name (scope "brand") or ASIN (scope "asin"). */
  identifier: string;
  /** explicit spike to attribute; omit → strongest passed spike. */
  eventId?: string;
  /** reserved for multi-store deployments; not used by the global read. */
  storeId?: string;
}

const slugify = (brand: string): string =>
  brand.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const isAsin = (s: string): boolean => /^[A-Z0-9]{10}$/.test(s.trim());

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function minusDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return isoDay(d);
}

type ProductRow = { id: string; external_id: string; title: string | null };
type SnapshotRow = { snapshot_date: string; rank: number | null; price: number | string | null };

/**
 * Resolve the product set + a flagship product, read its snapshot series, read
 * the brand's creator mentions, shape a MarketMoverInput and run the engine.
 *
 * Single-product focus: the pure engine's MarketMoverInput is one product. When
 * a brand resolves to several products we pick the flagship (best/lowest rank)
 * — the strongest mover — matching pebble's flagship selection in buildBundle.
 */
export async function runMarketMover(req: MarketMoverRequest): Promise<MarketMoverResult> {
  const bb = createBb();

  // 1) Resolve the product set.
  const { products, brandId, scopeLabel } = await resolveProducts(bb, req);
  if (products.length === 0) throw new EngineDataError("no products found for identifier");

  // 2) Read snapshots for every product; build a shared sorted date axis.
  const perProduct = new Map<string, Map<string, { rank: number | null; price: number | null }>>();
  const dateSet = new Set<string>();
  for (const p of products) {
    const snaps = unwrap(
      await bb
        .from("commerce_product_snapshot")
        .select("snapshot_date, rank, price")
        .eq("product_id", p.id)
        .order("snapshot_date", { ascending: true }),
    ) as SnapshotRow[];
    const m = new Map<string, { rank: number | null; price: number | null }>();
    for (const s of snaps ?? []) {
      const d = s.snapshot_date;
      dateSet.add(d);
      m.set(d, { rank: s.rank, price: s.price == null ? null : Number(s.price) });
    }
    perProduct.set(p.id, m);
  }
  const days = Array.from(dateSet).sort() as DateString[];
  if (days.length === 0) throw new EngineDataError("no snapshots found for product set");

  // 3) Pick the flagship = the product with the best (lowest) observed rank.
  const flagship = pickFlagship(products, perProduct);
  const fm = perProduct.get(flagship.id)!;

  // 4) Build the engine's RankPriceSeries for the flagship, aligned to `days`.
  //    Ranks must be a number[] (engine forward-fills gaps); we forward-fill
  //    nulls so detectSpikes sees a continuous series, mirroring the contract
  //    note "caller forward-fills gaps".
  const ranks: number[] = [];
  const prices: Array<number | null> = [];
  let lastRank: number | null = null;
  for (const d of days) {
    const cell = fm.get(d);
    const r: number | null = cell?.rank ?? lastRank;
    if (r != null) lastRank = r;
    ranks.push(r ?? 0);
    prices.push(cell?.price ?? null);
  }

  // 5) Read the brand's creator content (mentions). Resilient: any failure or
  //    missing brand → empty content → the engine still runs and returns
  //    "unexplained" verdicts (degrades exactly like pebble's step 2).
  const content = await readContent(bb, brandId);

  const input: MarketMoverInput = {
    product: { asin: flagship.external_id, title: flagship.title ?? scopeLabel },
    series: { dates: days, ranks, prices },
    content,
  };

  return findMarketMovers(input);
}

async function resolveProducts(
  bb: Bb,
  req: MarketMoverRequest,
): Promise<{ products: ProductRow[]; brandId: string | null; scopeLabel: string }> {
  if (req.scope === "asin" || isAsin(req.identifier)) {
    const asin = req.identifier.trim();
    const rows = (unwrapMaybe(
      await bb.from("commerce_product").select("id, external_id, title").eq("external_id", asin),
    ) ?? []) as ProductRow[];
    // brand_id for content: read it off the product if present.
    const brandId = await brandIdForProduct(bb, rows[0]?.id);
    return { products: rows, brandId, scopeLabel: asin };
  }

  const slug = slugify(req.identifier);
  const brand = unwrapMaybe(
    await bb.from("brand").select("id, name").eq("slug", slug).maybeSingle(),
  ) as { id: string; name: string | null } | null;
  if (!brand) throw new EngineDataError(`brand "${req.identifier}" not in cache`);

  const rows = (unwrapMaybe(
    await bb.from("commerce_product").select("id, external_id, title").eq("brand_id", brand.id),
  ) ?? []) as ProductRow[];
  return { products: rows, brandId: brand.id, scopeLabel: brand.name ?? req.identifier };
}

async function brandIdForProduct(bb: Bb, productId: string | undefined): Promise<string | null> {
  if (!productId) return null;
  try {
    const row = unwrapMaybe(
      await bb.from("commerce_product").select("brand_id").eq("id", productId).maybeSingle(),
    ) as { brand_id: string | null } | null;
    return row?.brand_id ?? null;
  } catch {
    return null;
  }
}

function pickFlagship(
  products: ProductRow[],
  perProduct: Map<string, Map<string, { rank: number | null; price: number | null }>>,
): ProductRow {
  let best: { product: ProductRow; rank: number } | null = null;
  for (const p of products) {
    const m = perProduct.get(p.id);
    if (!m) continue;
    for (const v of m.values()) {
      if (v.rank != null && (best == null || v.rank < best.rank)) best = { product: p, rank: v.rank };
    }
  }
  return best?.product ?? products[0]!;
}

/**
 * Read brand_mention rows in the brand and normalize to CreatorMention[].
 * Mirrors pebble's brand_mention read but unscoped by window — the engine does
 * its own per-spike windowing, so we hand it all the brand's content. Any error
 * → empty content (resilient).
 */
async function readContent(bb: Bb, brandId: string | null): Promise<CreatorMention[]> {
  if (!brandId) return [];
  try {
    const mentions: CreatorMention[] = [];
    // Paginate like buildBundle (cap at 12k rows).
    for (let off = 0; off < 12000; off += 1000) {
      const rows = (unwrapMaybe(
        await bb
          .from("brand_mention")
          .select(
            "creator_handle, platform, views, likes, comments, creator_followers, posted_at, external_url, cover_url",
          )
          .eq("brand_id", brandId)
          .range(off, off + 999),
      ) ?? []) as Array<Record<string, unknown>>;
      for (const m of rows) {
        const handle = m.creator_handle as string | null;
        if (!handle || handle === "unknown") continue;
        mentions.push({
          creatorHandle: handle,
          platform: m.platform as Platform,
          postedAt: (m.posted_at as string) ?? "",
          followers: (m.creator_followers as number) ?? null,
          views: (m.views as number) ?? null,
          likes: (m.likes as number) ?? null,
          comments: (m.comments as number) ?? null,
          url: (m.external_url as string) ?? null,
          coverUrl: (m.cover_url as string) ?? null,
        });
      }
      if (rows.length < 1000) break;
    }
    return mentions;
  } catch {
    return [];
  }
}

/** Distinguishable "expected" data error (vs an unexpected throw). */
export class EngineDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineDataError";
  }
}

/* ------------------------------- fixtures -------------------------------- */

/**
 * Optional fixtures fallback (ENGINE_FIXTURES=1) so the endpoints are
 * smoke-testable with NO Butterbase configured. Reuses pebble's real Rael BSR
 * daily panel: { days[], rows[{ asin, title, price, dailyRanks[] }] }. We pick
 * the flagship row and run the same engine. There's no creator content in the
 * fixture, so verdicts are "unexplained" — that still exercises spike detection
 * + the price gate end-to-end.
 */
export async function runMarketMoverFromFixtures(
  req: MarketMoverRequest,
): Promise<MarketMoverWithSeries> {
  const fixture = await loadFixture();
  if (!fixture) throw new EngineDataError("fixtures requested but fixture file not found");

  const days = fixture.days as DateString[];
  const rows = fixture.rows;
  if (!days.length || !rows.length) throw new EngineDataError("empty fixture");

  // ASIN scope → that exact row. BRAND scope → scan ALL products and return the
  // strongest mover (most detected bursts). The flagship (rank ~1) usually can't
  // burst, so picking it would hide the real market movers in the catalog.
  if (req.scope === "asin" || isAsin(req.identifier)) {
    const row = rows.find((r) => r.asin === req.identifier.trim());
    if (!row) throw new EngineDataError("no fixture row matched");
    const input = inputFromFixtureRow(row, days);
    return withSeries(findMarketMovers(input), input);
  }

  let best: MarketMoverResult | null = null;
  let bestInput: MarketMoverInput | null = null;
  let bestScore = -1;
  for (const row of rows) {
    const input = inputFromFixtureRow(row, days);
    const res = findMarketMovers(input);
    // Prefer a real creator attribution; otherwise the most bursts.
    const score = (res.topAttribution ? 1000 : 0) + res.spikes.length;
    if (score > bestScore) {
      bestScore = score;
      best = res;
      bestInput = input;
    }
  }
  if (!best || !bestInput) throw new EngineDataError("no fixture rows to analyze");
  return withSeries(best, bestInput);
}

/** Engine result + the rank series the UI charts (lower rank = better). */
export type MarketMoverWithSeries = MarketMoverResult & {
  series?: { dates: string[]; ranks: number[] };
  spikeDates?: string[];
};

function withSeries(result: MarketMoverResult, input: MarketMoverInput): MarketMoverWithSeries {
  return {
    ...result,
    series: { dates: input.series.dates, ranks: input.series.ranks },
    spikeDates: result.spikes.map((s) => s.date),
  };
}

/** Build a single-product MarketMoverInput from a fixture row (forward-filled). */
function inputFromFixtureRow(row: FixtureRow, days: DateString[]): MarketMoverInput {
  const ranks: number[] = [];
  let last = 0;
  for (const r of row.dailyRanks) {
    if (r != null) last = r;
    ranks.push(r ?? last);
  }
  const prices = days.map(() => (row.price ?? null));
  return {
    product: { asin: row.asin, title: row.title },
    series: { dates: days, ranks, prices },
    content: [], // fixture carries no creator content
  };
}

interface FixtureRow {
  asin: string;
  title: string;
  price: number | null;
  dailyRanks: Array<number | null>;
  minRank?: number | null;
}
interface Fixture {
  days: string[];
  rows: FixtureRow[];
}

const bestRank = (r: FixtureRow): number =>
  r.minRank ?? Math.min(...r.dailyRanks.filter((x): x is number => x != null), Number.POSITIVE_INFINITY);

let fixtureCache: Fixture | null | undefined;
async function loadFixture(): Promise<Fixture | null> {
  if (fixtureCache !== undefined) return fixtureCache;
  const path =
    process.env.ENGINE_FIXTURE_PATH ??
    "/Users/myoons/Gilbreth/pebble/apps/web/app/api/real-panel/rael-bsr-daily.json";
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(path, "utf8");
    fixtureCache = JSON.parse(raw) as Fixture;
  } catch {
    fixtureCache = null;
  }
  return fixtureCache;
}
