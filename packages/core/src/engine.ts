/**
 * Engine CONTRACTS — ported from storehaus `inertia`, redesigned to be PURE
 * and stateless: the engine takes plain series + mentions and returns plain
 * results. It knows nothing about Supabase, stores, fixtures, or the panel.
 * Concrete implementations live in @pebble/engine (Track B). The engine NEVER
 * imports @pebble/providers.
 *
 * Improvements over inertia (designed into the types):
 *  - parameterized (no hardcoded options/store/window)
 *  - decoupled from DB rows (CreatorMention, not a raw mention row)
 *  - confidence on every scored creator (vs inertia's binary attribution)
 *  - product/date mapping is the orchestrator's job, not the detector's
 */

import type { Platform, Timestamp } from "./primitives";

/* --------------------- spike detection (rolling Hampel) -------------------- */

export interface RankSeriesInput {
  /** daily rank series (lower = better); caller forward-fills gaps. */
  ranks: number[];
  /** optional category median daily log-returns (market-neutral), aligned 1:1. */
  categoryMedianReturns?: number[];
}

/** All optional; defaults match inertia's daily detector. */
export interface SpikeDetectionOptions {
  windowRadius?: number; // 28
  zThreshold?: number; // -5 (negative = improvement)
  minRankImprovement?: number; // 5
  minRankImprovementPct?: number; // 0.4
  minScale?: number; // 0.1 — floors robust scale (anti false-positive)
  minProminence?: number; // 0.5 — must stand out from trailing baseline
  maxRankTo?: number; // 2000 — relevance band, not steepness
}

export interface SpikeHit {
  index: number; // index into `ranks` where the spike lands
  rankFrom: number;
  rankTo: number;
  z: number; // modified z-score (more negative = stronger)
}

export type DetectSpikes = (input: RankSeriesInput, options?: SpikeDetectionOptions) => SpikeHit[];

/* --------------------------- creator cascade ------------------------------ */

/** Clean, DB-agnostic creator activity (NOT a raw mention row). */
export interface CreatorMention {
  creatorHandle: string;
  platform: Platform;
  accountId?: string;
  postedAt: Timestamp;
  followers?: number | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  url?: string | null;
  coverUrl?: string | null;
}

/** Per-view spike context shared across creators (the gauge baselines). */
export interface SpikeContext {
  rankFrom: number;
  rankTo: number;
  medianRank?: number | null;
  followerStart?: number | null;
  followerEnd?: number | null;
  typicalWeeklyGain?: number | null;
}

export type StageState = "real" | "awaiting";

/** One stage of the cascade (reaction / follower-inflow / amazon-rank). */
export interface StageOutlier {
  state: StageState;
  multiple: number | null; // ×baseline
  magnitude: number | null; // non-multiple headline (e.g. rank steps)
  sigma: number | null; // σ above the creator's own baseline
  strong: boolean;
  baselineLabel?: string;
  currentLabel?: string;
}

export interface ScoredCreator {
  key: string; // `${platform}:${handle}`
  handle: string;
  platform: Platform;
  accountId?: string;
  followers: number | null;
  /** log10(reach) + 0.15·reactionσ + 0.5·log2(mentions+1). */
  compositeSigma: number;
  /** 0..1 — IMPROVEMENT over inertia's binary attribution. */
  confidence: number;
  reaction: StageOutlier;
  followerInflow: StageOutlier;
  amazonRank: StageOutlier;
}

export interface CascadeOptions {
  limit?: number; // default 3
}

export type ScoreCascade = (
  mentions: CreatorMention[],
  spike?: SpikeContext | null,
  options?: CascadeOptions,
) => ScoredCreator[];
