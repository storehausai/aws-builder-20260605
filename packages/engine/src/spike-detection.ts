import type { DetectSpikes, RankSeriesInput, SpikeDetectionOptions, SpikeHit } from "@pebble/core";

/**
 * Rolling Hampel spike detector — ported from storehaus inertia
 * (spike-detection.ts). Pure: a rank series in, index-based hits out. Daily
 * defaults match the inertia daily detector (amazon-data.ts).
 */

const HAMPEL_K = 0.6745;

const DAILY_DEFAULTS: Required<SpikeDetectionOptions> = {
  windowRadius: 28,
  zThreshold: -5,
  minRankImprovement: 5,
  minRankImprovementPct: 0.4,
  minScale: 0.1,
  minProminence: 0.5,
  maxRankTo: 2000,
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function mad(values: number[], center: number): number {
  if (values.length === 0) return 0;
  return median(values.map((v) => Math.abs(v - center)));
}

/** Daily log-return of rank: r_d = ln(rank_d / rank_{d-1}). */
function logReturns(ranks: number[]): number[] {
  const out: number[] = new Array<number>(ranks.length).fill(0);
  for (let d = 1; d < ranks.length; d++) {
    const prev = ranks[d - 1]!;
    const cur = ranks[d]!;
    out[d] = prev > 0 && cur > 0 ? Math.log(cur / prev) : 0;
  }
  return out;
}

export const detectSpikes: DetectSpikes = (input: RankSeriesInput, options?: SpikeDetectionOptions): SpikeHit[] => {
  const opts = { ...DAILY_DEFAULTS, ...(options ?? {}) };
  const { ranks, categoryMedianReturns } = input;
  if (ranks.length < 3) return [];

  const raw = logReturns(ranks);
  // Market-neutral: subtract the category median return so only the
  // product-idiosyncratic component is scored.
  const resid = raw.map((r, d) => r - (categoryMedianReturns?.[d] ?? 0));

  const out: SpikeHit[] = [];
  for (let d = 1; d < ranks.length; d++) {
    const lo = Math.max(1, d - opts.windowRadius);
    const hi = Math.min(ranks.length - 1, d + opts.windowRadius);
    const window: number[] = [];
    for (let j = lo; j <= hi; j++) window.push(resid[j]!);

    const med = median(window);
    const scale = Math.max(mad(window, med) / HAMPEL_K, opts.minScale);
    if (scale === 0) continue;

    const z = (resid[d]! - med) / scale;
    const rankFrom = ranks[d - 1]!;
    const rankTo = ranks[d]!;
    const improvement = rankFrom - rankTo;
    const proportional = rankFrom > 0 ? improvement / rankFrom : 0;

    let prominence = 0;
    if (opts.minProminence > 0) {
      const trail = ranks.slice(Math.max(0, d - opts.windowRadius), d);
      const base = trail.length ? median(trail) : rankTo;
      prominence = base > 0 ? (base - rankTo) / base : 0;
    }

    if (
      z <= opts.zThreshold &&
      improvement >= opts.minRankImprovement &&
      proportional >= opts.minRankImprovementPct &&
      prominence >= opts.minProminence &&
      rankTo <= opts.maxRankTo
    ) {
      out.push({ index: d, rankFrom, rankTo, z });
    }
  }
  return out;
};
