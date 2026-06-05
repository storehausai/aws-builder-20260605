import type {
  DiscoveryResult,
  InfluencerSuggestion,
  OutreachResult,
  PanelInput,
  PanelResult,
} from "./types";

/**
 * Server-only adapter over `@pebble/pipelines`.
 *
 * The pipelines package owns the real discovery/outreach work (Butterbase AI
 * gateway + Instagram). We import it dynamically so that:
 *   1. these modules never get bundled into a client component, and
 *   2. if the package hasn't exported `runDiscovery`/`runOutreach` yet (it is a
 *      stub during early development), the demo still works via the local
 *      fallback instead of failing the build.
 *
 * Per the spec, `runDiscovery` already has its own internal fallback, so when it
 * IS present we simply render whatever it returns.
 */

type DiscoveryInput = { text: string; brandUrl?: string; storeId?: string };
type OutreachInput = { handle: string; draft?: string; brand?: string; storeId?: string };

type PipelinesModule = {
  runDiscovery?: (input: DiscoveryInput) => Promise<DiscoveryResult>;
  runOutreach?: (input: OutreachInput) => Promise<OutreachResult>;
  generatePanel?: (input: PanelInput) => Promise<PanelResult>;
};

async function loadPipelines(): Promise<PipelinesModule> {
  try {
    // Dynamic import keeps the (possibly stub) package off the static type graph.
    const mod = (await import("@pebble/pipelines")) as unknown as PipelinesModule;
    return mod ?? {};
  } catch {
    return {};
  }
}

export async function runDiscovery(input: DiscoveryInput): Promise<DiscoveryResult> {
  const mod = await loadPipelines();
  if (typeof mod.runDiscovery === "function") {
    try {
      const result = await mod.runDiscovery(input);
      if (result && Array.isArray(result.influencers)) return normalizeDiscovery(result, input);
    } catch (err) {
      console.warn("[pipelines] runDiscovery failed, using fallback:", err);
    }
  }
  return fallbackDiscovery(input);
}

export async function runOutreach(input: OutreachInput): Promise<OutreachResult> {
  const mod = await loadPipelines();
  if (typeof mod.runOutreach === "function") {
    try {
      const result = await mod.runOutreach(input);
      if (result && typeof result.message === "string") return result;
    } catch (err) {
      console.warn("[pipelines] runOutreach failed, using fallback:", err);
    }
  }
  return fallbackOutreach(input);
}

export async function runPanel(input: PanelInput): Promise<PanelResult> {
  const mod = await loadPipelines();
  if (typeof mod.generatePanel === "function") {
    try {
      const result = await mod.generatePanel(input);
      if (result && typeof result.html === "string" && result.html.includes("<")) return result;
    } catch (err) {
      console.warn("[pipelines] generatePanel failed, using fallback:", err);
    }
  }
  return fallbackPanel(input);
}

/* ------------------------------------------------------------------ */
/* Fallbacks — keep the live demo crash-proof without a live backend.  */
/* ------------------------------------------------------------------ */

function brandName(brandUrl: string | undefined): string {
  if (!brandUrl) return "the brand";
  try {
    const host = new URL(normalizeUrl(brandUrl)).hostname.replace(/^www\./, "");
    const core = host.split(".")[0] ?? host;
    return core.charAt(0).toUpperCase() + core.slice(1);
  } catch {
    return "the brand";
  }
}

function normalizeUrl(url: string): string {
  if (!/^https?:\/\//i.test(url)) return `https://${url}`;
  return url;
}

function normalizeDiscovery(result: DiscoveryResult, input: DiscoveryInput): DiscoveryResult {
  return {
    reply: result.reply || fallbackReply(input),
    steps: result.steps?.length ? result.steps : fallbackSteps(input),
    influencers: result.influencers ?? [],
  };
}

function fallbackSteps(input: DiscoveryInput): string[] {
  const host = (() => {
    try {
      return new URL(normalizeUrl(input.brandUrl ?? "")).hostname.replace(/^www\./, "");
    } catch {
      return input.brandUrl || "the brand";
    }
  })();
  return [
    `Reading ${host}…`,
    "Inferring category, voice & ideal customer…",
    "Pulling matching creators from the graph…",
    "Scoring by reach, engagement & brand fit…",
    "Ranking the shortlist…",
  ];
}

function fallbackReply(input: DiscoveryInput): string {
  const brand = brandName(input.brandUrl);
  return `Here's a shortlist of creators who fit ${brand}. I ranked them by audience reach and how closely their content overlaps with your category. Approve any of them to draft a DM.`;
}

function fallbackDiscovery(input: DiscoveryInput): DiscoveryResult {
  const brand = brandName(input.brandUrl);
  const seed = [
    {
      handle: "skincarebyhyram",
      followers: 1_400_000,
      score: 94,
      rationale: `Authority voice in skincare education — audience trusts his product picks, ideal for ${brand}.`,
    },
    {
      handle: "glowwithava",
      followers: 312_000,
      score: 91,
      rationale: "High save-rate routine content; followers actively shop her shelf.",
    },
    {
      handle: "thebudgetdermat",
      followers: 188_000,
      score: 88,
      rationale: "Derm-adjacent, value-focused reviews convert a price-sensitive audience.",
    },
    {
      handle: "minimalist.skin",
      followers: 96_400,
      score: 85,
      rationale: "Clean-beauty aesthetic mirrors the brand; strong comment engagement.",
    },
    {
      handle: "jules.routine",
      followers: 54_200,
      score: 82,
      rationale: "Micro-creator with an unusually loyal, high-intent skincare following.",
    },
    {
      handle: "dewy.diaries",
      followers: 27_800,
      score: 79,
      rationale: "Nano-creator; cheapest CPM here with authentic before/after storytelling.",
    },
  ];
  const influencers: InfluencerSuggestion[] = seed.map((s) => ({
    handle: s.handle,
    platform: "instagram",
    followers: s.followers,
    score: s.score,
    rationale: s.rationale,
  }));
  return {
    reply: fallbackReply(input),
    steps: fallbackSteps(input),
    influencers,
  };
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtFollowers(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

/**
 * Grounded static dashboard — only used when `@pebble/pipelines` isn't loaded
 * (early-dev stub). The package's own `generatePanel` has a richer fallback; this
 * just guarantees the iframe is never blank even with no backend at all.
 */
function fallbackPanel(input: PanelInput): PanelResult {
  const brand = input.brand?.trim() || brandName(input.brandUrl ?? "");
  const title = `${brand} — influencer dashboard`;
  const creators = (input.influencers ?? []).map((inf, i) => ({
    rank: i + 1,
    handle: inf.handle.replace(/^@/, ""),
    platform: (inf.platform || "instagram").toLowerCase(),
    followers: inf.followers ?? null,
    fit: inf.score == null ? null : inf.score <= 1 ? Math.round(inf.score * 100) : Math.round(inf.score),
    rationale: inf.rationale ?? "",
  }));
  const totalReach = creators.reduce((s, c) => s + (c.followers ?? 0), 0);
  const maxReach = Math.max(1, ...creators.map((c) => c.followers ?? 0));

  const rows = creators
    .map((c) => {
      const pct = Math.round(((c.followers ?? 0) / maxReach) * 100);
      return `<li class="row"><span class="rank${c.rank === 1 ? " rank-top" : ""}">${c.rank}</span><div class="who"><div class="handle">@${esc(
        c.handle,
      )} <span class="plat">${esc(c.platform)}</span></div><div class="bar"><span style="width:${pct}%"></span></div><div class="rat">${esc(
        c.rationale,
      )}</div></div><div class="metrics"><div class="foll">${esc(fmtFollowers(c.followers))}</div>${
        c.fit != null ? `<div class="fit">${c.fit}<span>&thinsp;/&thinsp;100</span></div>` : ""
      }</div></li>`;
    })
    .join("");

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><style>
:root{--bg:#ffffff;--sunken:#fbfbfa;--bd:#e9e9e7;--divider:#f0f0ef;--fg:#37352f;--subtle:#787774;--mut:#9b9a97;--acc:#b8562c;--pos:#22c55e;}
*{box-sizing:border-box;}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 ui-sans-serif,-apple-system,"Helvetica Neue",Arial,sans-serif;font-variant-numeric:tabular-nums;padding:28px;}
.title{font-family:"Iowan Old Style",Palatino,Georgia,ui-serif,serif;font-size:24px;font-weight:600;letter-spacing:-.01em;color:var(--fg);}
.sub{color:var(--mut);font-size:12.5px;margin:4px 0 20px;}
.kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:22px;}
.kpi{background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:12px 14px;}
.kpi-v{font-size:19px;font-weight:600;color:var(--fg);}.kpi-l{font-size:11.5px;color:var(--mut);margin-top:3px;}
.panel{background:var(--sunken);border:1px solid var(--bd);border-radius:8px;overflow:hidden;}ul{margin:0;padding:0;}
.row{list-style:none;display:flex;gap:14px;align-items:flex-start;padding:14px 16px;border-top:1px solid var(--divider);}.row:first-child{border-top:0;}
.rank{width:22px;height:22px;flex:0 0 auto;display:grid;place-items:center;border-radius:6px;background:#f0f0ef;color:var(--subtle);font-weight:600;font-size:12px;}
.rank-top{background:var(--acc);color:#fff;}
.who{flex:1;min-width:0;}.handle{font-weight:600;color:var(--fg);}.plat{font-size:11px;color:var(--mut);font-weight:500;text-transform:capitalize;margin-left:5px;}
.bar{height:5px;border-radius:999px;background:#f0f0ef;margin:8px 0;overflow:hidden;}.bar span{display:block;height:100%;border-radius:999px;background:var(--acc);}
.rat{color:var(--subtle);font-size:12.5px;}.metrics{text-align:right;flex:0 0 auto;}.foll{font-weight:600;color:var(--fg);}.fit{font-size:12px;color:var(--pos);font-weight:600;margin-top:2px;}.fit span{color:var(--mut);font-weight:500;}
</style></head><body><div class="title">${esc(title)}</div><div class="sub">Ranked by reach &amp; brand fit · ${creators.length} creators</div>
<div class="kpis"><div class="kpi"><div class="kpi-v">${creators.length}</div><div class="kpi-l">Creators</div></div><div class="kpi"><div class="kpi-v">${esc(
    fmtFollowers(totalReach),
  )}</div><div class="kpi-l">Combined reach</div></div></div><div class="panel"><ul>${rows}</ul></div></body></html>`;

  return { ok: true, title, html, source: "fallback" };
}

function fallbackOutreach(input: OutreachInput): OutreachResult {
  const brand = input.brand ?? "our brand";
  const message =
    input.draft?.trim() ||
    `Hi @${input.handle.replace(/^@/, "")} — I'm on the team at ${brand} and we love your content. ` +
      `We'd love to send you something to try and explore a paid collab if it's a fit. Open to chatting here?`;
  return {
    ok: true,
    channel: "instagram",
    handle: input.handle,
    message,
    delivered: false, // fallback can't actually deliver; UI shows "queued"
  };
}
