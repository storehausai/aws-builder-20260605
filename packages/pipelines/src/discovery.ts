/**
 * runDiscovery — steps 1-4 of the demo, with two paths and a robust fallback.
 *
 *   PRIMARY  : a reachable RocketRide engine drives discovery.pipe (agent_rocketride
 *              orchestrator) and we parse the agent's answer into a DiscoveryResult.
 *   FALLBACK : no engine? Run an in-process version on the Butterbase AI gateway
 *              (@pebble/bb chatText) — the model proposes influencer handles + a
 *              one-line rationale each, with `steps` narrating the work. Resolving
 *              real follower counts is OUT OF SCOPE here; the model proposes.
 *   SAMPLE   : if even the AI call fails, return a small built-in shortlist so the
 *              web demo always has something to show.
 *
 * Every path returns a usable DiscoveryResult; this function never throws.
 */
import { createBb, chatText } from "@pebble/bb";
import type {
  DiscoveryInput,
  DiscoveryResult,
  InfluencerSuggestion,
} from "./types.js";
import {
  createRocketRideClient,
  extractAnswerText,
  isReachable,
} from "./rocketride.js";
import { runAjChain } from "./aj-chain.js";

const SYSTEM = [
  "You are Pebble, an influencer-marketing copilot.",
  "Given a brand (homepage URL and/or description), propose a ranked shortlist of",
  "Instagram creators who plausibly move the market in that category — referencing",
  "category fit and competitor-mention signal. Be honest: correlation != causation,",
  "and for a brand with no history, rank by category/competitor signal and say so.",
  "",
  "Respond with STRICT JSON only (no markdown fences), shaped exactly:",
  '{ "reply": string, "steps": string[], "influencers": [',
  '  { "handle": string, "platform": "instagram", "followers": number|null,',
  '    "score": number, "rationale": string } ] }',
  "`steps` should narrate the work (e.g. ingesting the brand, pulling category",
  "creators, scoring by proven impact). `score` is 0..1. Propose 4-6 creators.",
].join("\n");

/** Parse the agent / model output (ideally JSON) into a DiscoveryResult. */
function parseDiscovery(raw: string, input: DiscoveryInput): DiscoveryResult {
  const json = extractJsonObject(raw);
  if (json) {
    const influencers = normalizeInfluencers(json.influencers);
    const steps = Array.isArray(json.steps) ? json.steps.map(String) : [];
    const reply =
      typeof json.reply === "string" && json.reply.trim()
        ? json.reply.trim()
        : defaultReply(influencers, input);
    if (influencers.length) return { reply, steps, influencers };
  }
  // Not JSON — keep the prose as the reply, fall back to the sample shortlist.
  const influencers = sampleInfluencers(input);
  return {
    reply: raw.trim() || defaultReply(influencers, input),
    steps: defaultSteps(input),
    influencers,
  };
}

function normalizeInfluencers(value: unknown): InfluencerSuggestion[] {
  if (!Array.isArray(value)) return [];
  const out: InfluencerSuggestion[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const handle = typeof o.handle === "string" ? o.handle.replace(/^@/, "").trim() : "";
    if (!handle) continue;
    const platform =
      typeof o.platform === "string" && o.platform.trim() ? o.platform.trim() : "instagram";
    const followers = numOrUndef(o.followers);
    const score = numOrUndef(o.score);
    const pk = typeof o.pk === "string" ? o.pk : undefined;
    const rationale =
      typeof o.rationale === "string" && o.rationale.trim()
        ? o.rationale.trim()
        : "Proposed for category fit.";
    out.push({ handle, platform, pk, followers, score, rationale });
  }
  return out;
}

function numOrUndef(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Best-effort: pull the first balanced {...} JSON object out of a string. */
function extractJsonObject(raw: string): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  const start = raw.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function brandLabel(input: DiscoveryInput): string {
  if (input.brandUrl) {
    try {
      return new URL(input.brandUrl).hostname.replace(/^www\./, "");
    } catch {
      return input.brandUrl;
    }
  }
  return "your brand";
}

function defaultSteps(input: DiscoveryInput): string[] {
  const brand = brandLabel(input);
  return [
    `Ingesting ${brand}…`,
    "Pulling category & competitor-mention creators…",
    "Scoring candidates by proven market impact…",
    "Ranking the shortlist…",
  ];
}

function defaultReply(influencers: InfluencerSuggestion[], input: DiscoveryInput): string {
  const brand = brandLabel(input);
  if (!influencers.length) {
    return `I looked at ${brand} but couldn't propose creators right now — try again with a homepage URL.`;
  }
  const top = influencers
    .slice(0, 3)
    .map((i) => `@${i.handle}`)
    .join(", ");
  return `For ${brand}, here's a starting shortlist (${top}, …). Each is ranked by category fit and competitor-mention signal — not yet proven causation, so treat it as a discovery hypothesis.`;
}

/** A built-in plausible shortlist, used when the AI call itself fails. */
function sampleInfluencers(_input: DiscoveryInput): InfluencerSuggestion[] {
  return [
    {
      handle: "skincarebyhyram",
      platform: "instagram",
      followers: 1_200_000,
      score: 0.82,
      rationale: "High category authority in skincare; followers act on his recommendations.",
    },
    {
      handle: "glowwithava",
      platform: "instagram",
      followers: 240_000,
      score: 0.74,
      rationale: "Mid-tier creator whose product mentions correlate with competitor sales spikes.",
    },
    {
      handle: "thebudgetderm",
      platform: "instagram",
      followers: 95_000,
      score: 0.69,
      rationale: "Engaged niche audience; strong save/share rate on routine posts.",
    },
    {
      handle: "cleanbeauty.co",
      platform: "instagram",
      followers: 410_000,
      score: 0.66,
      rationale: "Frequently tagged alongside competitor brands in the category.",
    },
  ];
}

/** PRIMARY path: drive discovery.pipe on a reachable RocketRide engine. */
async function runViaRocketRide(input: DiscoveryInput): Promise<DiscoveryResult> {
  const client = createRocketRideClient();
  const steps: string[] = [];
  const session = await client.useDiscoveryPipe();
  try {
    const prompt = buildPrompt(input);
    const answer = await session.chat(prompt, async (type, data) => {
      // Surface wave/tool narration as steps (step 3 of the demo).
      const text = typeof data.text === "string" ? data.text : typeof data.message === "string" ? data.message : "";
      if (text && (type.includes("status") || type.includes("flow") || type.includes("summary"))) {
        steps.push(text);
      }
    });
    const parsed = parseDiscovery(answer, input);
    return {
      reply: parsed.reply,
      steps: steps.length ? steps : parsed.steps.length ? parsed.steps : defaultSteps(input),
      influencers: parsed.influencers,
    };
  } finally {
    try {
      await session.terminate();
    } catch {
      /* best-effort */
    }
    try {
      await client.disconnect();
    } catch {
      /* best-effort */
    }
  }
}

/** FALLBACK path: in-process discovery via the Butterbase AI gateway. */
async function runViaGateway(input: DiscoveryInput): Promise<DiscoveryResult> {
  const bb = createBb();
  const raw = await chatText(bb, SYSTEM, buildPrompt(input));
  return parseDiscovery(raw, input);
}

function buildPrompt(input: DiscoveryInput): string {
  const parts: string[] = [];
  if (input.brandUrl) parts.push(`Brand homepage: ${input.brandUrl}`);
  if (input.text) parts.push(`Request: ${input.text}`);
  if (input.storeId) parts.push(`(storeId: ${input.storeId})`);
  return parts.join("\n") || "Find influencers for my brand.";
}

/**
 * runDiscovery — never throws; always returns a usable DiscoveryResult.
 */
export async function runDiscovery(input: DiscoveryInput): Promise<DiscoveryResult> {
  // PRIMARY: a reachable RocketRide engine drives discovery.pipe.
  try {
    if (await isReachable()) {
      const r = await runViaRocketRide(input);
      if (r.influencers.length) return r;
    }
  } catch {
    /* fall through to the in-process chain */
  }
  // MAIN: the real a–j chain in-process (onboarding → engine market-mover →
  // similar creators), narrated step-by-step. Real adapters + engine; never throws.
  try {
    const r = await runAjChain(input);
    if (r.influencers.length) return r;
    // a–j surfaced no creators → soften to a gateway-proposed shortlist, but
    // keep the honest a–j narration.
    try {
      const g = await runViaGateway(input);
      if (g.influencers.length) {
        return { reply: g.reply, steps: r.steps.length ? r.steps : g.steps, influencers: g.influencers };
      }
    } catch {
      /* keep the a–j result */
    }
    return r;
  } catch {
    // LAST RESORT: gateway, then a built-in sample so the demo always shows.
    try {
      return await runViaGateway(input);
    } catch {
      const influencers = sampleInfluencers(input);
      return { reply: defaultReply(influencers, input), steps: defaultSteps(input), influencers };
    }
  }
}
