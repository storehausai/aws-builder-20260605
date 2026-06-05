import type { PanelSpec, PanelInfluencer } from "@pebble/bb";

/**
 * panelCard — the single source of truth for what the iMessage *link preview*
 * says and shows. Both the page's OpenGraph `<meta>` tags (the card title +
 * summary) and the rendered OG image read from this, so the card the marketer
 * sees in their notification and the image inside it never drift apart.
 *
 * This is deliberately a small, pure shaping function: given the panel's
 * grounding spec, decide the headline, the one-line summary, and which creators
 * to feature on the card. It's the highest-leverage "product voice" surface in
 * the whole iMessage flow — the marketer reads THIS before they ever tap.
 */
export interface PanelCard {
  /** Card headline (becomes `og:title`). */
  title: string;
  /** One-line summary under the title (becomes `og:description`). */
  summary: string;
  /** The creators to feature on the card image, already ranked + capped. */
  featured: FeaturedCreator[];
}

export interface FeaturedCreator {
  handle: string;
  platform: string;
  /** Fit as a 0–100 percentage, or null when discovery had no score. */
  fitPct: number | null;
  followers: number | null;
}

/** Compact follower counts the way a marketer reads them: 1.2M, 48K, 900. */
export function formatFollowers(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

function fitPct(score: number | null | undefined): number | null {
  if (score == null || !Number.isFinite(score)) return null;
  // Discovery scores are a 0..1 composite; the panel speaks in whole percent.
  return Math.round(score * 100);
}

/**
 * Build the card content from a saved panel spec.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 👉 YOUR CONTRIBUTION (the product decision lives here — ~6–10 lines)
 *
 * The default below is intentionally plain: brand name as the title, a flat
 * "N creators found" summary, and the top 3 creators by score. That works, but
 * it's not persuasive. This is the text a marketer sees in their lock-screen
 * notification — what would make THEM tap?
 *
 * Consider shaping `title` and `summary` (and how many creators to feature):
 *   • Lead with the single best creator?  e.g.
 *       title:   `${brand}: @${top.handle} is a 94% fit`
 *       summary: `+ ${rest} more skincare creators ranked by audience overlap`
 *   • Lead with the aggregate reach?  e.g.
 *       summary: `${formatFollowers(totalReach)} combined reach across ${n} creators`
 *   • Surface WHY (the rationale) vs. just the numbers?
 *   • Feature 1 hero creator, or a 3-up lineup? (drives the image layout too)
 *
 * Edit the marked block below. Everything downstream (meta tags + OG image)
 * picks your changes up automatically.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function panelCard(spec: PanelSpec): PanelCard {
  const brand = spec.brand?.trim() || "Storehaus";
  const ranked = [...(spec.influencers ?? [])].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0),
  );

  // ▼▼▼ shape these three values ▼▼▼
  const featuredCount = 3;
  const title = `${brand} — ${ranked.length} creator${ranked.length === 1 ? "" : "s"} matched`;
  const summary =
    ranked.length > 0
      ? `Top pick @${ranked[0].handle}${
          fitPct(ranked[0].score) != null ? ` · ${fitPct(ranked[0].score)}% fit` : ""
        }. Tap to open the full panel.`
      : "Tap to open the panel.";
  // ▲▲▲ shape these three values ▲▲▲

  return {
    title,
    summary,
    featured: ranked.slice(0, featuredCount).map(toFeatured),
  };
}

function toFeatured(i: PanelInfluencer): FeaturedCreator {
  return {
    handle: i.handle,
    platform: i.platform,
    fitPct: fitPct(i.score),
    followers: i.followers ?? null,
  };
}
