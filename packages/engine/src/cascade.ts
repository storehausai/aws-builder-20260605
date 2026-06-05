import type { CreatorMention, ScoreCascade, ScoredCreator, StageOutlier } from "@pebble/core";

/**
 * Creator cascade — a real (simplified) port of inertia's influencer-cascade.
 * Groups real mentions by creator and scores an engagement composite:
 *   compositeSigma = log10(reach+1) + 0.15·reactionσ + 0.5·log2(mentions+1)
 * Adds a real confidence (0..1) — the improvement over inertia's binary flag.
 */

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function std(xs: number[], m: number): number {
  if (xs.length < 2) return 0;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}
function awaiting(): StageOutlier {
  return { state: "awaiting", multiple: null, magnitude: null, sigma: null, strong: false };
}

export const scoreCascade: ScoreCascade = (mentions, spike, options) => {
  const limit = options?.limit ?? 3;
  if (mentions.length === 0) return [];

  // global engagement-rate baseline (likes+comments)/views
  const rate = (m: CreatorMention) => {
    const eng = (m.likes ?? 0) + (m.comments ?? 0);
    return eng / Math.max(m.views ?? 0, eng, 1);
  };
  const baseMean = mean(mentions.map(rate));
  const baseSd = std(mentions.map(rate), baseMean) || 1;

  const byCreator = new Map<string, CreatorMention[]>();
  for (const m of mentions) {
    const key = `${m.platform}:${m.creatorHandle}`;
    (byCreator.get(key) ?? byCreator.set(key, []).get(key)!).push(m);
  }

  const scored: ScoredCreator[] = [];
  for (const [key, ms] of byCreator) {
    const first = ms[0]!;
    const reach = ms.reduce((s, m) => s + (m.views ?? 0), 0);
    const eng = ms.reduce((s, m) => s + (m.likes ?? 0) + (m.comments ?? 0), 0);
    const creatorRate = eng / Math.max(reach, eng, 1);
    const reactionSigma = (creatorRate - baseMean) / baseSd;
    const repetition = ms.length;
    const compositeSigma = Math.log10(reach + 1) + reactionSigma * 0.15 + Math.log2(repetition + 1) * 0.5;
    const confidence = Math.max(0, Math.min(1, (reactionSigma + 2) / 6));

    const reaction: StageOutlier = {
      state: "real",
      multiple: baseMean > 0 ? creatorRate / baseMean : null,
      magnitude: eng,
      sigma: reactionSigma,
      strong: reactionSigma >= 2,
      baselineLabel: `avg ${(baseMean * 100).toFixed(1)}%`,
      currentLabel: `${(creatorRate * 100).toFixed(1)}%`,
    };
    const amazonRank: StageOutlier = spike
      ? { state: "real", multiple: null, magnitude: spike.rankFrom - spike.rankTo, sigma: null, strong: spike.rankFrom - spike.rankTo >= 5, baselineLabel: `#${spike.rankFrom}`, currentLabel: `#${spike.rankTo}` }
      : awaiting();

    scored.push({
      key,
      handle: first.creatorHandle,
      platform: first.platform,
      accountId: first.accountId,
      followers: first.followers ?? null,
      compositeSigma,
      confidence,
      reaction,
      followerInflow: awaiting(),
      amazonRank,
    });
  }

  scored.sort((a, b) => b.compositeSigma - a.compositeSigma);
  return scored.slice(0, limit);
};
