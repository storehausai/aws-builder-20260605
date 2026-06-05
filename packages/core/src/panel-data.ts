/**
 * PanelDataBundle — the SEAM between the engine and the panel.
 *
 * The agent reads canonical data → runs @pebble/engine → assembles this bundle →
 * hands it to the LLM, which writes JSX that only PRESENTS it. The LLM cannot
 * invent numbers (grounding). Sections are optional so the agent composes only
 * what the request needs — this is NOT workflow-locked; any panel reads a subset.
 *
 * Built from reusable primitives (KpiValue, TimeSeries, RankSeriesView, …) so
 * different panel types share them instead of each inventing a shape.
 */

import type { DateString, Platform, ProviderId, Timestamp } from "./primitives";
import type { ScoredCreator, SpikeHit } from "./engine";
import type { PriceGate } from "./market-mover";

export interface KpiValue {
  label: string;
  value: number | string;
  unit?: string;
  delta?: number | null;
}

/** One point on a shared daily axis; null = honest gap (not zero). */
export interface DailyPoint {
  date: DateString;
  value: number | null;
}

export interface TimeSeries {
  name: string; // 'followerDelta' | 'reactions' | 'contentCounts' | …
  points: DailyPoint[];
}

export interface RankSeriesView {
  productId: string;
  asin: string;
  title: string | null;
  ranks: Array<number | null>; // aligned to meta.days
  currentRank: number | null;
  medianRank: number | null;
  bestRank: number | null;
}

/** A spike placed in product/time context (the orchestrator adds these). */
export interface ContextualSpike extends SpikeHit {
  productId: string;
  date: DateString;
}

/** A detected spike enriched for the panel: price-gate result + the persisted
 *  event id (null until written) + the attributed top creator handle. */
export interface SpikeMarker extends ContextualSpike {
  eventId: string | null;
  gate: PriceGate;
  priceChangePct: number | null;
  topCreator?: string | null;
}

export interface ContentCard {
  id: string;
  platform: Platform;
  handle?: string;
  postedAt: Timestamp;
  caption: string | null;
  coverUrl: string | null;
  url: string | null;
  views: number | null;
  reactions: number | null;
}

export interface PanelDataBundle {
  meta: {
    storeId: string;
    requestId?: string;
    brand?: string;
    generatedAt: Timestamp;
    sources?: ProviderId[];
    /** the shared daily axis, when the panel is time-series shaped. */
    days?: DateString[];
  };
  kpis?: KpiValue[];
  rankSeries?: RankSeriesView[];
  spikes?: ContextualSpike[];
  series?: TimeSeries[];
  creators?: ScoredCreator[];
  cards?: ContentCard[];
  window?: { start: DateString; end: DateString } | null;
}
