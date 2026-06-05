/**
 * MARKET MOVER — the one workflow, encoded as a contract.
 *
 *   rank series ─▶ detect spike ─▶ PRICE GATE (discard if price dropped)
 *               ─▶ window content 0..−N days before the spike
 *               ─▶ score creators ─▶ attribute the influencer ("suppose")
 *
 * The job, in the product's words: "find the creator who moved the market."
 * Pure and DB-agnostic, like the rest of the engine: dated series + dated
 * creator content in, an explainable verdict per spike out. The price gate is
 * the causal filter — a spike with a price drop is explained by the discount,
 * not a creator, so it never reaches attribution.
 */

import type { DateString } from "./primitives";
import type {
  CreatorMention,
  ScoredCreator,
  SpikeDetectionOptions,
} from "./engine";

/** Rank + price for one product, aligned 1:1 to `dates`. */
export interface RankPriceSeries {
  /** ISO dates, ascending; ranks/prices index-align to this. */
  dates: DateString[];
  /** daily BSR (lower = better); caller forward-fills gaps. */
  ranks: number[];
  /** daily price aligned to `dates`; null where unknown. */
  prices: Array<number | null>;
}

export interface MarketMoverInput {
  /** ASIN + human title for labelling the panel. */
  product: { asin: string; title?: string };
  series: RankPriceSeries;
  /** dated creator content for the brand (Apify-normalized). */
  content: CreatorMention[];
  spikeOptions?: SpikeDetectionOptions;
  /** look-back window in days for content before a spike. Default 7. */
  windowDays?: number;
  /** min fractional price drop that "explains" a spike. Default 0.05 (5%). */
  priceDropThreshold?: number;
}

/**
 * Why a spike happened:
 *  - price_drop     → a discount explains it (gate caught it) — discarded
 *  - creator_driven → price flat AND a creator posted in the window — attributed
 *  - unexplained    → price flat but no creator content in the window
 */
export type SpikeVerdict = "price_drop" | "creator_driven" | "unexplained";

export type PriceGate = "passed" | "discounted";

/** One detected spike, carried all the way through the gate + attribution. */
export interface AttributedSpike {
  index: number;
  date: DateString;
  rankFrom: number;
  rankTo: number;
  z: number;
  /** baseline price just before the spike (median of the days leading in). */
  priceBefore: number | null;
  priceAt: number | null;
  /** (priceAt − priceBefore) / priceBefore; negative = a drop. */
  priceChangePct: number | null;
  gate: PriceGate;
  verdict: SpikeVerdict;
  windowStart: DateString;
  windowEnd: DateString;
  /** creators scored within the window (empty when gated out). */
  creators: ScoredCreator[];
  /** the single best creator = the "suppose"; null when none qualify. */
  attribution: ScoredCreator | null;
}

export interface MarketMoverResult {
  productTitle?: string;
  /** every spike the detector found, each with its verdict. */
  spikes: AttributedSpike[];
  /** spikes that passed the price gate AND attributed a creator. */
  attributed: AttributedSpike[];
  /** the headline finding across the whole product: the strongest attribution. */
  topAttribution: { spike: AttributedSpike; creator: ScoredCreator } | null;
}

export type FindMarketMovers = (input: MarketMoverInput) => MarketMoverResult;
