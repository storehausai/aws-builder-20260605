/**
 * Adapter around `@pebble/pipelines`' `runDiscovery`.
 *
 * The pipelines package is a peer team's deliverable and may not export
 * `runDiscovery` yet (its `index.ts` is currently a stub). To keep THIS worker
 * compiling and running regardless of pipelines' state, we resolve `runDiscovery`
 * dynamically at call time rather than importing it by name. When it isn't
 * available we degrade to a friendly placeholder reply instead of crashing.
 *
 * We also normalize the return shape: the spec calls for
 * `runDiscovery({ text }) -> { reply, top? }`, while the BUILD-PLAN sketch shows
 * `runDiscovery(text) -> string`. We tolerate both.
 */
import type { PanelInfluencer } from "@pebble/bb";

/** Coerce one loosely-typed pipeline influencer into our panel shape. */
function toPanelInfluencer(o: Record<string, unknown>): PanelInfluencer {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    handle: String(o.handle ?? o.username ?? "").replace(/^@/, ""),
    platform: typeof o.platform === "string" ? o.platform : "instagram",
    pk: typeof o.pk === "string" ? o.pk : undefined,
    followers: num(o.followers),
    score: num(o.score),
    rationale: typeof o.rationale === "string" ? o.rationale : "",
  };
}

export interface DiscoveryResult {
  /** The text to send back to the marketer over iMessage. */
  reply: string;
  /** Optional one-line-per-influencer summary lines to append. */
  top?: string[];
  /**
   * The structured ranked influencers behind this reply. Carried through so the
   * worker can persist a panel and text back a tappable link to it. Empty/absent
   * when discovery produced no creators (e.g. a degraded reply).
   */
  influencers?: PanelInfluencer[];
  /** Brand display name, when discovery resolved one. Grounds the panel. */
  brand?: string;
  /**
   * The agent's narrated work, one line per step — the same `steps` the
   * dashboard reveals one-at-a-time beside the chat. We replay these as interim
   * iMessage texts so a text conversation feels as "alive" as the dashboard.
   */
  steps?: string[];
}

type RunDiscoveryFn = (
  arg: { text: string; convId?: string; storeId?: string; brandUrl?: string } | string,
) => unknown;

let cached: RunDiscoveryFn | null | undefined;

async function resolveRunDiscovery(): Promise<RunDiscoveryFn | null> {
  if (cached !== undefined) return cached;
  try {
    const mod = (await import("@pebble/pipelines")) as Record<string, unknown>;
    const fn = mod.runDiscovery;
    cached = typeof fn === "function" ? (fn as RunDiscoveryFn) : null;
  } catch (err) {
    console.warn("[discovery] @pebble/pipelines not importable:", errText(err));
    cached = null;
  }
  return cached;
}

function normalize(raw: unknown): DiscoveryResult {
  if (typeof raw === "string") return { reply: raw };
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const reply =
      typeof obj.reply === "string"
        ? obj.reply
        : typeof obj.text === "string"
          ? obj.text
          : typeof obj.answer === "string"
            ? obj.answer
            : JSON.stringify(obj);
    const top = Array.isArray(obj.top)
      ? obj.top.map((t) => (typeof t === "string" ? t : JSON.stringify(t)))
      : undefined;
    const influencers = Array.isArray(obj.influencers)
      ? (obj.influencers as Record<string, unknown>[]).map(toPanelInfluencer)
      : undefined;
    const brand = typeof obj.brand === "string" ? obj.brand : undefined;
    const steps = Array.isArray(obj.steps)
      ? obj.steps.filter((s): s is string => typeof s === "string")
      : undefined;
    return { reply, top, influencers, brand, steps };
  }
  return { reply: String(raw) };
}

/**
 * Run discovery for an inbound marketer message. Never throws — on any failure
 * it returns a degraded reply so the iMessage loop always responds.
 */
export interface DiscoveryOptions {
  convId?: string;
  /** Grounds discovery on the brand — the same inputs the dashboard passes. */
  storeId?: string;
  brandUrl?: string;
}

export async function runDiscovery(
  text: string,
  opts: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const fn = await resolveRunDiscovery();
  if (!fn) {
    return {
      reply:
        "I'm online, but the discovery pipeline (@pebble/pipelines.runDiscovery) " +
        "isn't wired up yet. Send me a store URL once it's live and I'll find influencers.",
    };
  }
  try {
    // Same input shape the dashboard's /api/discover sends, so the iMessage
    // reply is grounded identically: { text, convId, storeId, brandUrl }.
    const out = await Promise.resolve(
      fn({ text, convId: opts.convId, storeId: opts.storeId, brandUrl: opts.brandUrl }),
    );
    return normalize(out);
  } catch (errObj) {
    try {
      // Retry with the positional-string signature from the BUILD-PLAN sketch.
      const out = await Promise.resolve(fn(text));
      return normalize(out);
    } catch (err) {
      console.error("[discovery] runDiscovery failed:", errText(err));
      return { reply: "Sorry — discovery hit an error. Please try again." };
    }
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
