/**
 * Keepa adapter — Amazon rank + price history → canonical commerce shape.
 *
 * Design rule for this file: SIMPLE and ERROR-PROOF. Plain functions, explicit
 * null guards, informative errors, no clever abstractions. Everything that is
 * non-obvious about Keepa's wire format is commented inline.
 *
 * Endpoints (verified against keepacom/api_backend Request.java and the Keepa
 * API docs at keepa.com/#!api):
 *   - GET https://api.keepa.com/product?key=KEY&domain=1&asin=A,B,...&history=1
 *       (add &buybox=1 — +2 tokens/product — for the exact featured price)
 *   - GET https://api.keepa.com/query?key=KEY&domain=1&selection=<urlencoded JSON>
 *       (the "Product Finder"; selection is a JSON body, response has `asinList`)
 */

import type {
  Capability,
  CommerceProduct,
  CommerceSignalProvider,
  DateString,
  NormalizedCommerce,
  NormalizedProductPoint,
  ProductRef,
  RawFetch,
} from "@pebble/core";

/* ----------------------------- constants ------------------------------ */

const KEEPA_BASE = "https://api.keepa.com";
const PROVIDER_ID = "keepa";
const CAPABILITY: Capability = "commerce.timeseries";

/**
 * csv[] index meanings (Keepa "product object" csv). Only the ones we read.
 * Each csv[i] is a flat array of alternating [keepaMinutes, value, ...].
 */
const CSV_AMAZON = 0; // Amazon (Amazon-as-seller) price, in cents
const CSV_NEW = 1; // lowest 3rd-party NEW offer, in cents (price fallback)
const CSV_SALES = 3; // SALES rank (BSR), plain integer
const CSV_RATING = 16; // rating ×10 (45 => 4.5)
const CSV_COUNT_REVIEWS = 17; // review count, plain integer
// Buy Box price — the FEATURED offer a shopper actually pays (== what Amazon's
// page and Keepa's own price-history show). The AMAZON/NEW fields above track
// specific seller slots and can go stale when that slot's offer disappears,
// so the Buy Box is the authoritative "current price" and we prefer it.
// IMPORTANT wire-format gotcha: csv[18] is stored as [time, price, shipping]
// TRIPLES, not [time, value] pairs — it must be parsed with the triple reader.
const CSV_BUYBOX = 18; // BUY_BOX_SHIPPING, in cents (TRIPLES: time, price, shipping)

/** Keepa's "value missing" sentinel. Appears as a value in any csv[i]. */
const NO_DATA = -1;

/** /product accepts at most 100 ASINs per call (without offers). */
const MAX_ASINS_PER_CALL = 100;

/* ------------------------- vendor-native types ------------------------ */
/** Minimal shapes we rely on; Keepa returns much more, we keep it verbatim. */

interface KeepaProduct {
  asin?: string;
  title?: string | null;
  imagesCSV?: string | null;
  categoryTree?: Array<{ catId?: number; name?: string }> | null;
  /** 2-D history array; csv[i] may be null when that metric has no history. */
  csv?: Array<number[] | null> | null;
}

interface KeepaResponse {
  products?: KeepaProduct[];
  /** Product Finder returns matched ASINs here. */
  asinList?: string[];
  tokensLeft?: number;
  tokensConsumed?: number;
  refillIn?: number; // ms until next refill
  refillRate?: number; // tokens per minute
  error?: { message?: string } | null;
}

/* ------------------------------ helpers ------------------------------- */

/** Convert a Keepa-minutes timestamp to an ISO date string (YYYY-MM-DD). */
function keepaMinutesToDate(keepaMinutes: number): DateString {
  // Verified formula: unixMs = (keepaMinutes + 21564000) * 60000.
  const unixMs = (keepaMinutes + 21564000) * 60000;
  return new Date(unixMs).toISOString().slice(0, 10);
}

/**
 * Reduce one flat Keepa csv series ([min, val, min, val, ...]) to a per-day
 * map of the LAST observed value on each calendar day. -1 ("no data") values
 * are skipped entirely so they never produce a bogus point.
 */
function seriesToDailyMap(series: number[] | null | undefined): Map<DateString, number> {
  const byDay = new Map<DateString, number>();
  if (!series || series.length === 0) return byDay;
  // Walk pairs. Guard against a malformed odd-length array by stepping by 2
  // and bounds-checking the value slot.
  for (let i = 0; i + 1 < series.length; i += 2) {
    const keepaMinutes = series[i];
    const value = series[i + 1];
    if (typeof keepaMinutes !== "number" || typeof value !== "number") continue;
    if (value === NO_DATA) continue; // skip "no data" — caller forward-fills
    const day = keepaMinutesToDate(keepaMinutes);
    byDay.set(day, value); // later events on the same day overwrite — last wins
  }
  return byDay;
}

/**
 * Reduce a Buy Box series to a per-day map of the LAST price on each day.
 * Unlike the pair series above, csv[18] is stored as [time, price, shipping]
 * TRIPLES, so we step by 3 and read the PRICE slot (i+1). Shipping (i+2) is
 * intentionally ignored — we want the displayed item price, matching Amazon's
 * page and Keepa's stats.buyBoxPrice. -1 prices ("no buy box") are skipped.
 */
function buyBoxSeriesToDailyMap(series: number[] | null | undefined): Map<DateString, number> {
  const byDay = new Map<DateString, number>();
  if (!series || series.length === 0) return byDay;
  for (let i = 0; i + 2 < series.length; i += 3) {
    const keepaMinutes = series[i];
    const price = series[i + 1];
    if (typeof keepaMinutes !== "number" || typeof price !== "number") continue;
    if (price === NO_DATA) continue; // -1 => no buy box on this observation
    byDay.set(keepaMinutesToDate(keepaMinutes), price); // last on the day wins
  }
  return byDay;
}

/**
 * Look up a forward-filled value for `day` in a daily map, given the sorted
 * list of days that map actually has. Returns the value on the most recent day
 * <= `day`, or null if there is no prior observation (no back-fill).
 */
function forwardFill(
  byDay: Map<DateString, number>,
  sortedDays: DateString[],
  day: DateString,
): number | null {
  let result: number | null = null;
  for (const d of sortedDays) {
    if (d > day) break; // sortedDays ascending — past our target, stop
    result = byDay.get(d) ?? result;
  }
  return result;
}

/** First image id from imagesCSV → full Amazon CDN URL, or null. */
function imageUrlFromCsv(imagesCSV: string | null | undefined): string | null {
  if (!imagesCSV) return null;
  const first = imagesCSV.split(",")[0]?.trim();
  if (!first) return null;
  return `https://m.media-amazon.com/images/I/${first}`;
}

/** Deepest (last) category name from the tree, or null. */
function categoryFromTree(tree: KeepaProduct["categoryTree"]): string | null {
  if (!tree || tree.length === 0) return null;
  const last = tree[tree.length - 1];
  return last?.name ?? null;
}

/** Sorted union of all calendar days present across the given daily maps. */
function unionDays(maps: Array<Map<DateString, number>>): DateString[] {
  const all = new Set<DateString>();
  for (const m of maps) for (const d of m.keys()) all.add(d);
  return [...all].sort(); // ISO date strings sort chronologically
}

/* ----------------------------- HTTP core ------------------------------ */

/**
 * Fetch JSON from a Keepa endpoint and apply uniform error handling:
 * - HTTP 429 → rate-limited error
 * - negative tokensLeft → rate-limited error
 * - vendor `error` field → surfaced as a clear error
 */
async function keepaGet(url: string): Promise<KeepaResponse> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (cause) {
    throw new Error(`keepa: network error calling ${redact(url)}: ${String(cause)}`);
  }

  if (res.status === 429) {
    throw new Error("keepa: rate limited (HTTP 429)");
  }
  if (!res.ok) {
    throw new Error(`keepa: HTTP ${res.status} ${res.statusText} from ${redact(url)}`);
  }

  let body: KeepaResponse;
  try {
    body = (await res.json()) as KeepaResponse;
  } catch (cause) {
    throw new Error(`keepa: invalid JSON response: ${String(cause)}`);
  }

  if (typeof body.tokensLeft === "number" && body.tokensLeft < 0) {
    throw new Error(`keepa: rate limited (tokensLeft=${body.tokensLeft})`);
  }
  if (body.error && body.error.message) {
    throw new Error(`keepa: api error: ${body.error.message}`);
  }
  return body;
}

/** Strip the api key from a URL before putting it in an error message. */
function redact(url: string): string {
  return url.replace(/key=[^&]+/i, "key=***");
}

/* ------------------------------ factory ------------------------------- */

/** The adapter type: the port plus the Keepa-specific extras. */
export interface KeepaAdapter extends CommerceSignalProvider {
  resolveBrand(brand: string, limit?: number): Promise<Array<{ asin: string; title: string }>>;
  getBrandAsinsRaw(brand: string, limit?: number): Promise<RawFetch>;
  getProductsHistory(asins: string[]): Promise<RawFetch>;
}

/**
 * Build a Keepa adapter.
 * @param apiKey Keepa API key.
 * @param domain Keepa domain ordinal (1 = amazon.com). Defaults to 1.
 */
export function createKeepaAdapter(apiKey: string, domain = 1): KeepaAdapter {
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("keepa: apiKey is required");
  }
  const key = encodeURIComponent(apiKey);

  /**
   * Find a brand's ASINs via the Keepa Product Finder.
   * GET /query?key=&domain=&selection=<urlencoded JSON>
   * The selection body filters by brand; response carries `asinList`.
   * (Title is not returned by the finder, so we leave it empty here — call
   *  getProductsHistory on the asins to obtain titles.)
   */
  async function resolveBrand(
    brand: string,
    limit = 20,
  ): Promise<Array<{ asin: string; title: string }>> {
    // Reuse the raw Product Finder fetch so the /query logic lives in one place.
    const raw = await getBrandAsinsRaw(brand, limit);
    const body = raw.payload as KeepaResponse;
    const asins = Array.isArray(body.asinList) ? body.asinList : [];
    // Title is intentionally empty: the finder does not return titles.
    return asins.slice(0, limit).map((asin) => ({ asin, title: "" }));
  }

  /**
   * Same Product Finder /query call as resolveBrand, but returns the verbatim
   * Keepa response as an L0 RawFetch (payload contains `asinList`) for archival.
   */
  async function getBrandAsinsRaw(brand: string, limit = 20): Promise<RawFetch> {
    if (!brand || brand.trim() === "") {
      throw new Error("keepa: getBrandAsinsRaw requires a non-empty brand");
    }
    // Keepa Product Finder rejects perPage below ~50 ("too small"), so request at
    // least 50 (capped at 100) and let resolveBrand slice down to `limit`.
    const perPage = Math.min(Math.max(limit, 50), 100);
    // sort by current sales rank ASCENDING → best-selling products first, so the
    // flagship lands inside `limit` instead of being cut off in an arbitrary order.
    const selection = JSON.stringify({
      brand: [brand],
      page: 0,
      perPage,
      sort: [["current_SALES", "asc"]],
    });
    const url =
      `${KEEPA_BASE}/query?key=${key}&domain=${domain}` +
      `&selection=${encodeURIComponent(selection)}`;
    const payload = await keepaGet(url);
    return {
      providerId: PROVIDER_ID,
      capability: "commerce.product",
      payload, // verbatim Keepa response (L0); contains `asinList`
      fetchedAt: new Date().toISOString(),
      endpoint: redact(url),
    };
  }

  /**
   * Fetch rank + price history for one or more ASINs.
   * A single /product call with history=1 returns BOTH rank and price.
   */
  async function getProductsHistory(asins: string[]): Promise<RawFetch> {
    if (!Array.isArray(asins) || asins.length === 0) {
      throw new Error("keepa: getProductsHistory requires at least one ASIN");
    }
    if (asins.length > MAX_ASINS_PER_CALL) {
      throw new Error(
        `keepa: too many ASINs (${asins.length}); max ${MAX_ASINS_PER_CALL} per call`,
      );
    }
    const cleaned = asins.map((a) => a.trim()).filter((a) => a.length > 0);
    if (cleaned.length === 0) {
      throw new Error("keepa: getProductsHistory received only empty ASINs");
    }
    const asinParam = encodeURIComponent(cleaned.join(","));
    // history=1 only → 1 token/product. This carries BSR rank (the spike
    // signal) + Amazon/NEW price history, which is all the market-mover scan
    // needs. We deliberately DO NOT request buybox here: it costs +2 tokens
    // (3×) and only sharpens the *current* price, which can otherwise read
    // stale. To get the exact featured price for a few spike-candidate ASINs,
    // append `&buybox=1` — normalize already prefers csv[18] when present.
    const endpoint =
      `${KEEPA_BASE}/product?key=${key}&domain=${domain}` +
      `&asin=${asinParam}&history=1`;
    const payload = await keepaGet(endpoint);
    return {
      providerId: PROVIDER_ID,
      capability: CAPABILITY,
      payload, // verbatim Keepa response (L0)
      fetchedAt: new Date().toISOString(),
      endpoint: redact(endpoint),
    };
  }

  /** Single-product convenience wrapper (the port method). */
  async function getProductHistory(ref: ProductRef): Promise<RawFetch> {
    if (!ref || !ref.externalId) {
      throw new Error("keepa: getProductHistory requires a ProductRef with externalId");
    }
    return getProductsHistory([ref.externalId]);
  }

  /**
   * Parse a stored Keepa response into canonical products + a DAILY,
   * forward-filled point series per product.
   */
  function normalizeProductHistory(raw: RawFetch): NormalizedCommerce {
    if (!raw || raw.payload == null) {
      throw new Error("keepa: normalizeProductHistory received an empty RawFetch");
    }
    const payload = raw.payload as KeepaResponse;
    const keepaProducts = Array.isArray(payload.products) ? payload.products : [];

    const products: Array<Omit<CommerceProduct, "id">> = [];
    const points: NormalizedProductPoint[] = [];

    for (const p of keepaProducts) {
      const asin = (p.asin ?? "").trim();
      if (!asin) continue; // can't key a product without an ASIN — skip it

      // ---- canonical product (brandId null: the writer resolves it later) ----
      products.push({
        marketplace: "amazon",
        externalId: asin,
        brandId: null,
        title: p.title ?? null,
        imageUrl: imageUrlFromCsv(p.imagesCSV),
        category: categoryFromTree(p.categoryTree),
      });

      // ---- daily series ----
      const csv = Array.isArray(p.csv) ? p.csv : [];

      // Build a per-day map for each metric we care about.
      const rankMap = seriesToDailyMap(csv[CSV_SALES]);
      const buyBoxMap = buyBoxSeriesToDailyMap(csv[CSV_BUYBOX]); // triples!
      const amazonMap = seriesToDailyMap(csv[CSV_AMAZON]);
      const newMap = seriesToDailyMap(csv[CSV_NEW]);
      const ratingMap = seriesToDailyMap(csv[CSV_RATING]);
      const reviewMap = seriesToDailyMap(csv[CSV_COUNT_REVIEWS]);

      // Sorted day-lists for forward-fill lookups.
      const rankDays = [...rankMap.keys()].sort();
      const buyBoxDays = [...buyBoxMap.keys()].sort();
      const amazonDays = [...amazonMap.keys()].sort();
      const newDays = [...newMap.keys()].sort();
      const ratingDays = [...ratingMap.keys()].sort();
      const reviewDays = [...reviewMap.keys()].sort();

      // Emit one point per calendar day in the union of ALL metric days, so a
      // price-only or rating-only day still gets a row. Each metric is
      // forward-filled independently.
      const days = unionDays([rankMap, buyBoxMap, amazonMap, newMap, ratingMap, reviewMap]);

      for (const day of days) {
        const rank = forwardFill(rankMap, rankDays, day);

        // Price: prefer the BUY BOX (the featured price a shopper actually
        // pays), then fall back to the Amazon price, then the NEW price. The
        // Amazon/NEW slots can go stale when their offer disappears, so the buy
        // box is the source of truth whenever it is present.
        const buyBoxCents = forwardFill(buyBoxMap, buyBoxDays, day);
        const amazonCents = forwardFill(amazonMap, amazonDays, day);
        const newCents = forwardFill(newMap, newDays, day);
        const cents = buyBoxCents ?? amazonCents ?? newCents;
        const price = cents == null ? null : cents / 100; // cents → dollars

        const ratingRaw = forwardFill(ratingMap, ratingDays, day);
        const rating = ratingRaw == null ? null : ratingRaw / 10; // ×10 → real

        const reviewCount = forwardFill(reviewMap, reviewDays, day);

        points.push({
          marketplace: "amazon",
          externalId: asin,
          snapshotDate: day,
          rank,
          price,
          rating,
          reviewCount,
        });
      }
    }

    return { products, points };
  }

  return {
    id: PROVIDER_ID,
    capabilities: [CAPABILITY],
    resolveBrand,
    getBrandAsinsRaw,
    getProductHistory,
    getProductsHistory,
    normalizeProductHistory,
  };
}

/**
 * Convenience placeholder adapter satisfying the CommerceSignalProvider port.
 *
 * It has the right `id`/`capabilities` and a working `normalizeProductHistory`
 * (pure, no key needed), but any NETWORK method throws a clear error telling
 * the caller to build a keyed instance via `createKeepaAdapter(apiKey)`. We do
 * not read `process.env` here so this module needs no Node type dependency.
 */
export const keepaAdapter: KeepaAdapter = createKeepaAdapter("__MISSING_KEEPA_API_KEY__");
