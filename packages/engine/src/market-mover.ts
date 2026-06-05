import type {
  MarketMoverInput,
  AttributedSpike,
  FindMarketMovers,
  ScoredCreator,
  SpikeVerdict,
} from "@pebble/core";
import { detectSpikes } from "./spike-detection";
import { scoreCascade } from "./cascade";

/**
 * The market-mover workflow as deterministic code (Track B).
 *
 *   detectSpikes → PRICE GATE → window content [date−N, date] → scoreCascade
 *   → attribute the top creator.
 *
 * The price gate is the causal filter: a spike whose price dropped ≥ threshold
 * is "explained" by the discount and never reaches creator attribution. Only
 * flat-price spikes are eligible for "a creator moved the market".
 */

/** ISO date shift without mutating; pure string→string. */
function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 0 ? (xs[mid - 1]! + xs[mid]!) / 2 : xs[mid]!;
}

export const findMarketMovers: FindMarketMovers = (input: MarketMoverInput) => {
  const { series, content, product } = input;
  const windowDays = input.windowDays ?? 7;
  const priceDropThreshold = input.priceDropThreshold ?? 0.05;

  const hits = detectSpikes({ ranks: series.ranks }, input.spikeOptions);

  const spikes: AttributedSpike[] = hits.map((h) => {
    const date = series.dates[h.index] ?? "";

    // Baseline price = median of the days leading into the spike (robust to a
    // single noisy reading). priceAt = price on the spike day.
    const priceAt = series.prices[h.index] ?? null;
    const lead = series.prices
      .slice(Math.max(0, h.index - windowDays), h.index)
      .filter((p): p is number => p != null);
    const priceBefore = median(lead);

    const priceChangePct =
      priceBefore != null && priceBefore > 0 && priceAt != null
        ? (priceAt - priceBefore) / priceBefore
        : null;

    // GATE: a drop of ≥ threshold means the discount explains the spike.
    const discounted = priceChangePct != null && priceChangePct <= -priceDropThreshold;
    const gate = discounted ? "discounted" : "passed";

    // WINDOW: creator content uploaded 0..−windowDays before the spike.
    const windowStart = date ? addDays(date, -windowDays) : "";
    const windowEnd = date;
    const windowed = content.filter((c) => {
      if (!c.postedAt) return false;
      const day = c.postedAt.slice(0, 10);
      return day >= windowStart && day <= windowEnd;
    });

    const creators: ScoredCreator[] =
      gate === "passed"
        ? scoreCascade(windowed, { rankFrom: h.rankFrom, rankTo: h.rankTo }, { limit: 5 })
        : [];
    const attribution = creators[0] ?? null;

    const verdict: SpikeVerdict = discounted
      ? "price_drop"
      : attribution
        ? "creator_driven"
        : "unexplained";

    return {
      index: h.index,
      date,
      rankFrom: h.rankFrom,
      rankTo: h.rankTo,
      z: h.z,
      priceBefore,
      priceAt,
      priceChangePct,
      gate,
      verdict,
      windowStart,
      windowEnd,
      creators,
      attribution,
    };
  });

  const attributed = spikes
    .filter((s) => s.verdict === "creator_driven" && s.attribution)
    .sort((a, b) => b.attribution!.compositeSigma - a.attribution!.compositeSigma);

  const top = attributed[0] ?? null;

  return {
    productTitle: product.title,
    spikes,
    attributed,
    topAttribution: top ? { spike: top, creator: top.attribution! } : null,
  };
};
