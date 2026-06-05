/**
 * generatePanel — the AI "dashboard artifact" (Claude-Artifacts style).
 *
 * This is the shipping mechanism for the right-hand panel:
 * the agent GROUNDS a small data bundle on REAL discovery output (the ranked
 * influencers + brand), then asks the Butterbase AI gateway to write a COMPLETE,
 * self-contained HTML document. The web app renders that string verbatim in a
 * sandboxed `<iframe srcDoc sandbox="allow-scripts">` — no component library, no
 * build step, fully origin-isolated. Each generation is visually unique, exactly
 * like a Claude Artifact.
 *
 * Grounding: the model may ONLY use the numbers/handles in the bundle JSON — it
 * cannot invent metrics. If the gateway is unreachable or returns non-HTML, we
 * fall back to a hand-built (also grounded) dashboard so the panel is NEVER
 * blank. `generatePanel` never throws.
 */
import { createBb, chatText, DEFAULT_MODEL } from "@pebble/bb";
import type { InfluencerSuggestion, PanelInput, PanelResult } from "./types.js";

/* ------------------------------------------------------------------ */
/* The grounded data bundle (the seam between discovery and the LLM).  */
/* ------------------------------------------------------------------ */

interface PanelCreator {
  rank: number;
  handle: string;
  platform: string;
  followers: number | null;
  fit: number | null; // 0..100
  rationale: string;
}

interface PanelBundle {
  brand: string;
  generatedAt: string;
  kpis: { label: string; value: string; unit?: string }[];
  creators: PanelCreator[];
}

function normFit(score?: number | null): number | null {
  if (score == null || Number.isNaN(score)) return null;
  return score <= 1 ? Math.round(score * 100) : Math.round(score);
}

function fmtFollowers(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildBundle(input: PanelInput): PanelBundle {
  const brand = (input.brand?.trim() || hostFromUrl(input.brandUrl) || "the brand").trim();
  const creators: PanelCreator[] = (input.influencers ?? []).map((inf, i) => ({
    rank: i + 1,
    handle: inf.handle.replace(/^@/, ""),
    platform: (inf.platform || "instagram").toLowerCase(),
    followers: inf.followers ?? null,
    fit: normFit(inf.score),
    rationale: inf.rationale ?? "",
  }));

  const totalReach = creators.reduce((s, c) => s + (c.followers ?? 0), 0);
  const platforms = [...new Set(creators.map((c) => c.platform))];
  const topFit = creators.reduce((m, c) => Math.max(m, c.fit ?? 0), 0);

  const kpis = [
    { label: "Creators", value: String(creators.length) },
    { label: "Combined reach", value: fmtFollowers(totalReach) },
    { label: "Top fit", value: topFit ? String(topFit) : "—", unit: topFit ? " / 100" : "" },
    { label: "Platforms", value: platforms.map(titleCase).join(" · ") || "—" },
  ];

  return { brand, generatedAt: new Date().toISOString(), kpis, creators };
}

function hostFromUrl(url?: string): string | null {
  if (!url) return null;
  try {
    const u = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const host = new URL(u).hostname.replace(/^www\./, "");
    const core = host.split(".")[0] ?? host;
    return titleCase(core);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* AI generation (the artifact).                                      */
/* ------------------------------------------------------------------ */

/**
 * The system prompt is structured per Anthropic's own guidance (verified via
 * deep research, 2026-06): labeled sections, hard-constraints separated from
 * soft design guidance, the data placed at the TOP of the user turn, a direct
 * "no preamble" instruction (the old prefill trick now 400s on 4.6+ models),
 * concrete design TOKENS + negative aesthetic constraints (vague adjectives
 * can't override the model's default house style), explicit anti-truncation,
 * and a grounding stack (provided-data-only + render N/A, never fabricate).
 *
 * The design system is a restrained, editorial dashboard aesthetic: a refined
 * Notion-editorial look, not the generic dark-glassmorphism the model defaults
 * to. Keep this in lockstep with `staticPanelHtml` below.
 */
const HTML_SYSTEM = [
  "<role>",
  "You are a senior product designer and front-end engineer at a top-tier analytics company.",
  "You build ONE thing, exceptionally well: a single self-contained HTML panel that presents an",
  "influencer-marketing data bundle as a world-class dashboard. You work like a domain expert with",
  "strong taste — not a generic web-page generator.",
  "</role>",
  "",
  "<hard_constraints>",
  "- Output a COMPLETE single HTML document and NOTHING else. Begin at <!DOCTYPE html>, end at </html>.",
  '- No preamble, no commentary, no markdown, no code fences. Never start with "Here is", "Sure", or "```".',
  "- ONE file: all CSS in a single inline <style>, all JS in a single inline <script>. No external CSS,",
  "  fonts, or JS — EXCEPT you may load Chart.js v4 from https://cdnjs.cloudflare.com. Nothing else external.",
  '- Write the ENTIRE document out. No truncation, no minimization, no placeholder comments like',
  '  "<!-- rest unchanged -->" or "/* ... */". Every element fully written.',
  "- It renders inside a ~720px-wide panel with no body margin. Design for that width; scroll vertically.",
  "</hard_constraints>",
  "",
  "<grounding>",
  "- The JSON bundle in the user message is your ONLY source of truth. Use ONLY its numbers, handles,",
  "  labels and brand name. Do NOT use outside knowledge. NEVER invent, infer, or inflate a value,",
  "  creator, metric or date that is not in the bundle.",
  "- Render each value as given (you may add thousands separators and keep at most 1 decimal).",
  '- If a field is missing or null, show a literal "—" — never fabricate a plausible number to fill a gap.',
  "- Before finishing, silently check that every figure on screen maps to a bundle field; drop any that doesn't.",
  "</grounding>",
  "",
  "<design_system>",
  "Match this EXACT editorial design system (a refined, Notion-calibrated analytics look). Use these tokens:",
  "- Surfaces: #FFFFFF page, #FBFBFA sunken panels. Text: #37352F primary, #787774 subtle, #9B9A97 muted.",
  "- Hairline borders #E9E9E7 (1px); row dividers #F0F0EF. No heavy shadows — at most a faint hover lift.",
  "- Accent (sparing — top rank, chart, emphasis): burnt sienna #B8562C (darker #8E3E1F). Positive #22C55E, negative #EF4444.",
  "- Chart series palette: #3B82F6 #A855F7 #10B981 #EC4899 #06B6D4 #F59E0B.",
  "- Radius 8px on cards, 6px on small elements. KPI tiles in a 4-column grid (2 cols under 560px), 12px gaps.",
  "  Ranked rows separated by 1px #F0F0EF hairlines. Generous whitespace.",
  "- Type: a serif display face for the title/header (\"Iowan Old Style\", Palatino, Georgia, ui-serif, serif)",
  "  paired with a clean humanist sans for body and numbers (ui-sans-serif, -apple-system, \"Helvetica Neue\", Arial).",
  "  Use tabular numerals for figures.",
  "</design_system>",
  "",
  "<frontend_aesthetics>",
  "NEVER produce the generic AI aesthetic: no Inter/Roboto/Arial as the PRIMARY face, no purple or indigo",
  "gradients (on dark OR white), no glassmorphism, no neon, no emoji used as iconography. This is a calm,",
  "restrained, premium editorial product — high-contrast and confident, as if hand-crafted by a senior designer.",
  "</frontend_aesthetics>",
  "",
  "<data_viz>",
  "- Compose: a header (brand + one-line subtitle), a KPI row from bundle.kpis, ONE chart, and a ranked",
  "  creator list (rank, @handle, platform, followers, fit score, rationale).",
  "- Choose the chart by data shape: for creator reach, a HORIZONTAL bar chart of followers per creator,",
  "  descending. If the bundle carries a rank time-series, draw a line chart with a LOGARITHMIC, REVERSED",
  "  y-axis (best rank on top) and mark detected spikes as points. Skip creators with null followers from the chart.",
  "- All text must meet WCAG AA contrast (>=4.5:1). Never encode meaning by color alone — pair it with a label.",
  "  Label axes and units.",
  "</data_viz>",
  "",
  "<output>",
  "Respond with the raw HTML document ONLY, starting exactly with <!DOCTYPE html>.",
  "</output>",
].join("\n");

function buildUserPrompt(bundle: PanelBundle): string {
  // Data FIRST (Anthropic: long inputs near the top), directive LAST.
  return [
    "Here is the data bundle — your ONLY source of truth. Do not alter any value:",
    "```json",
    JSON.stringify(bundle, null, 2),
    "```",
    "",
    `Now generate the complete single-file HTML dashboard for "${bundle.brand}" using only this bundle.`,
    "Output only the HTML document, beginning exactly with <!DOCTYPE html> and ending with </html>.",
  ].join("\n");
}

/**
 * Post-processing (replaces the now-broken prefill trick): strip any stray code
 * fence or preamble and slice from the first doctype/html tag to the last
 * </html>. Returns null if no HTML document is present.
 */
function cleanHtml(raw: string): string | null {
  if (!raw) return null;
  let html = raw.trim();
  const fence = html.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) html = fence[1].trim();
  const start = html.search(/<!doctype html|<html[\s>]/i);
  const endIdx = html.toLowerCase().lastIndexOf("</html>");
  if (start === -1 || endIdx === -1) return null;
  return html.slice(start, endIdx + "</html>".length).trim();
}

export async function generatePanel(input: PanelInput): Promise<PanelResult> {
  const bundle = buildBundle(input);
  const title = `${bundle.brand} — influencer dashboard`;

  try {
    const bb = createBb();
    const raw = await chatText(bb, HTML_SYSTEM, buildUserPrompt(bundle), {
      model: DEFAULT_MODEL,
      // Moderate temperature: variety comes from the concrete token spec, not
      // from heat that would break the inline script. maxTokens high enough to
      // emit a full, untruncated document.
      temperature: 0.6,
      maxTokens: 12000,
    });
    const html = cleanHtml(raw);
    if (html) return { ok: true, title, html, source: DEFAULT_MODEL };
  } catch {
    /* fall through to the grounded static dashboard */
  }

  return { ok: true, title, html: staticPanelHtml(title, bundle), source: "fallback" };
}

/* ------------------------------------------------------------------ */
/* Grounded static fallback — never let the panel go blank.           */
/* ------------------------------------------------------------------ */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Hand-built, grounded HTML dashboard used when the AI path is unavailable.
 * Same Notion-editorial design system the AI prompt specifies, so the
 * panel looks consistent whichever path renders it.
 */
export function staticPanelHtml(title: string, bundle: PanelBundle): string {
  const maxReach = Math.max(1, ...bundle.creators.map((c) => c.followers ?? 0));
  const kpiCards = bundle.kpis
    .map(
      (k) => `
      <div class="kpi">
        <div class="kpi-v">${esc(String(k.value))}<span class="kpi-u">${esc(k.unit ?? "")}</span></div>
        <div class="kpi-l">${esc(k.label)}</div>
      </div>`,
    )
    .join("");

  const rows = bundle.creators
    .map((c) => {
      const pct = Math.round(((c.followers ?? 0) / maxReach) * 100);
      return `
      <li class="row">
        <span class="rank${c.rank === 1 ? " rank-top" : ""}">${c.rank}</span>
        <div class="who">
          <div class="handle">@${esc(c.handle)} <span class="plat">${esc(c.platform)}</span></div>
          <div class="bar"><span style="width:${pct}%"></span></div>
          <div class="rat">${esc(c.rationale)}</div>
        </div>
        <div class="metrics">
          <div class="foll">${esc(fmtFollowers(c.followers))}</div>
          ${c.fit != null ? `<div class="fit">${c.fit}<span>&thinsp;/&thinsp;100</span></div>` : ""}
        </div>
      </li>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  :root { --bg:#ffffff; --sunken:#fbfbfa; --bd:#e9e9e7; --divider:#f0f0ef; --fg:#37352f; --subtle:#787774; --mut:#9b9a97; --acc:#b8562c; --pos:#22c55e; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.55 ui-sans-serif,-apple-system,"Helvetica Neue",Arial,sans-serif; font-variant-numeric:tabular-nums; padding:28px; }
  .head { margin-bottom:20px; }
  .title { font-family:"Iowan Old Style",Palatino,Georgia,ui-serif,serif; font-size:24px; font-weight:600; letter-spacing:-.01em; color:var(--fg); }
  .sub { color:var(--mut); font-size:12.5px; margin-top:4px; }
  .kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:22px; }
  @media (max-width:560px){ .kpis { grid-template-columns:repeat(2,1fr); } }
  .kpi { background:var(--bg); border:1px solid var(--bd); border-radius:8px; padding:12px 14px; }
  .kpi-v { font-size:19px; font-weight:600; letter-spacing:-.01em; color:var(--fg); }
  .kpi-u { font-size:12px; color:var(--mut); font-weight:500; }
  .kpi-l { font-size:11.5px; color:var(--mut); margin-top:3px; }
  .panel { background:var(--sunken); border:1px solid var(--bd); border-radius:8px; overflow:hidden; }
  ul { margin:0; padding:0; }
  .row { list-style:none; display:flex; gap:14px; align-items:flex-start; padding:14px 16px; border-top:1px solid var(--divider); }
  .row:first-child { border-top:0; }
  .rank { width:22px; height:22px; flex:0 0 auto; display:grid; place-items:center; border-radius:6px; background:#f0f0ef; color:var(--subtle); font-weight:600; font-size:12px; }
  .rank-top { background:var(--acc); color:#fff; }
  .who { flex:1; min-width:0; }
  .handle { font-weight:600; color:var(--fg); }
  .plat { font-size:11px; color:var(--mut); font-weight:500; text-transform:capitalize; margin-left:5px; }
  .bar { height:5px; border-radius:999px; background:#f0f0ef; margin:8px 0; overflow:hidden; }
  .bar span { display:block; height:100%; border-radius:999px; background:var(--acc); }
  .rat { color:var(--subtle); font-size:12.5px; }
  .metrics { text-align:right; flex:0 0 auto; }
  .foll { font-weight:600; color:var(--fg); }
  .fit { font-size:12px; color:var(--pos); font-weight:600; margin-top:2px; }
  .fit span { color:var(--mut); font-weight:500; }
</style></head>
<body>
  <div class="head">
    <div class="title">${esc(title)}</div>
    <div class="sub">Ranked by reach &amp; brand fit · ${bundle.creators.length} creators · generated ${esc(bundle.generatedAt.slice(0, 10))}</div>
  </div>
  <div class="kpis">${kpiCards}</div>
  <div class="panel"><ul>${rows}</ul></div>
</body></html>`;
}

/** Re-exported for the web fallback so a missing pipelines build still renders. */
export type { InfluencerSuggestion };
