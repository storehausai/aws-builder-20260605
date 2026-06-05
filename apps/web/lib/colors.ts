/**
 * JS mirror of the Storehaus/Notion color tokens defined in
 * `app/globals.css`. Required for contexts that can't read CSS custom
 * properties (Recharts SVG fill/stroke, inline styles on the panels) so the
 * AI-generated stats blocks match the Notion design source exactly.
 */

/* ─── Notion editorial palette (intentionally NOT theme-followers) ─── */
export const NOTION_TEXT = "#37352f";
export const NOTION_TEXT_MUTED = "#9b9a97";
export const NOTION_TEXT_SUBTLE = "#787774";
export const NOTION_TEXT_DIM = "#a49b95";

export const NOTION_BORDER = "#e9e9e7";
export const NOTION_BG_HOVER = "#f0efed";
export const NOTION_BG_NEUTRAL = "#f0f0ee";

export const NOTION_GREEN_DARK = "#0f7b0f";
export const NOTION_RED = "#e03e3e";
export const NOTION_BLUE = "#2383e2";
export const NOTION_AMBER = "#9f6b16";

/* ─── Brand (burnt sienna) ─── */
export const BRAND_PRIMARY = "#B8562C";
export const BRAND_PRIMARY_DARK = "#8e3e1f";

/* ─── Chart palette (Recharts SVG attributes) ─── */
export const CHART_INK = "#37352F";
export const CHART_AXIS_TICK = "#9ca3af";
export const CHART_SUCCESS = "#22c55e";
export const CHART_GRAY_MUTED = "#a3a3a3";

export const CHART_PLATFORM_PALETTE = {
  tiktok: "#37352F",
  instagram: "#C13584",
  youtube: "#CC2B2B",
} as const;
