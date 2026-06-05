/**
 * @pebble/messaging — the Photon/Spectrum worker.
 *
 * Connects the agent to messaging:
 *   1. The marketer talks to the agent over iMessage. Inbound iMessage text →
 *      `runDiscovery({ text })` → reply (+ optional top influencers) back to the
 *      same space.
 *   2. Influencer Instagram-DM replies are relayed to the marketer's iMessage.
 *      Instagram is NOT a built-in Spectrum provider, so IG inbound runs as a
 *      SEPARATE concurrent poll loop (see `instagram-channel.ts`) that records
 *      each DM to Butterbase and relays it to the marketer over iMessage.
 *
 * Two async loops run together under `Promise.all`:
 *   • the Spectrum `for await (const [space, message] of app.messages)` loop
 *   • the Instagram inbound poll loop
 *
 * RESILIENCE: the worker boots and stays up even if IG isn't logged in or
 * Butterbase isn't configured — those features warn and disable themselves while
 * the iMessage loop keeps running.
 *
 * EXACT spectrum-ts v1.18.0 API used:
 *   import { Spectrum } from "spectrum-ts";
 *   import { imessage } from "spectrum-ts/providers/imessage";
 *   import { terminal } from "spectrum-ts/providers/terminal";
 *   const app = await Spectrum({ projectId, projectSecret, providers: [imessage.config()] });
 *   // projectless fallback:
 *   const app = await Spectrum({ providers: [terminal.config()] });
 *   for await (const [space, message] of app.messages) {
 *     // message.platform: string; message.content: { type: "text"; text } | ...
 *     await space.send("text");                       // string is a valid ContentInput
 *   }
 *   const ig = imessage(app);                          // PlatformInstance
 *   const marketerSpace = await ig.space({ phone });   // resolve a DM space by handle
 */
import "dotenv/config";
import { Spectrum, richlink, type Space, type Message } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { terminal } from "spectrum-ts/providers/terminal";
import type { IgInboundMessage } from "@pebble/outreach";
import { createBb, ensureMessagingStore, savePanel } from "@pebble/bb";

import { loadConfig, hasSpectrumCloud, type MessagingConfig } from "./config.js";
import { runDiscovery, type DiscoveryResult } from "./discovery.js";
import { ButterbaseRecorder } from "./butterbase-recorder.js";
import { runInstagramChannel } from "./instagram-channel.js";

/** Pull plain text out of an inbound message's content union, if any. */
function textOf(message: Message): string | undefined {
  const c = message.content;
  return c.type === "text" ? c.text : undefined;
}

/** Compose the discovery reply (+ optional top-influencer lines) into one send. */
function composeReply(reply: string, top: string[] | undefined): string {
  if (!top || top.length === 0) return reply;
  return [reply, "", ...top.map((t) => `• ${t}`)].join("\n");
}

/**
 * Persist the discovery result as a panel and text back a tappable link to it.
 * iMessage can't host the interactive HTML panel inline, so we save the panel's
 * grounding spec, then send a `richlink` — Photon fetches `/panel/[id]` and
 * renders a preview card (title, summary, OG image) the marketer can tap to
 * open the full dashboard in Safari.
 *
 * Best-effort: any failure here is swallowed so the text reply still lands. A
 * missing/`localhost` public URL is skipped (it can't unfurl on a phone).
 */
async function deliverPanelLink(
  space: Space,
  result: DiscoveryResult,
  cfg: MessagingConfig,
): Promise<void> {
  const influencers = result.influencers ?? [];
  if (influencers.length === 0) return;
  const base = cfg.publicWebUrl;
  if (!base || /^https?:\/\/(localhost|127\.|0\.0\.0\.0)/.test(base)) {
    console.warn(
      "[worker] skipping panel link — PUBLIC_WEB_URL is unset or local; a phone can't reach it.",
    );
    return;
  }
  try {
    const bb = createBb();
    const storeId = await ensureMessagingStore(bb);
    // Pre-render the panel HTML now so the viewer (and the iMessage card unfurl)
    // serve instantly instead of regenerating — and so the link-preview crawler
    // doesn't time out waiting on a ~60s AI generation.
    const html = await renderPanelHtml(result).catch((err) => {
      console.warn("[worker] panel pre-render failed; viewer will lazy-render:", errText(err));
      return undefined;
    });
    const id = await savePanel(bb, {
      storeId,
      title: result.brand ? `${result.brand} — creators` : "Recommended creators",
      spec: { brand: result.brand, influencers, html },
    });
    const url = `${base.replace(/\/$/, "")}/panel/${id}`;
    await space.send(richlink(url));
    console.log(`[worker] sent panel link: ${url}`);
  } catch (err) {
    console.warn("[worker] panel link failed (text reply still sent):", errText(err));
  }
}

/**
 * Generate the panel HTML via `@pebble/pipelines.generatePanel`, resolved
 * dynamically (same defensive pattern as discovery — the package may not export
 * it yet). Returns undefined when unavailable, so the viewer can lazy-render.
 */
async function renderPanelHtml(result: DiscoveryResult): Promise<string | undefined> {
  const mod = (await import("@pebble/pipelines")) as Record<string, unknown>;
  const gen = mod.generatePanel;
  if (typeof gen !== "function") return undefined;
  const panel = (await (gen as (i: unknown) => Promise<unknown>)({
    brand: result.brand,
    influencers: result.influencers ?? [],
  })) as { html?: string } | undefined;
  return panel?.html;
}

/**
 * Build the Spectrum app. Uses the iMessage provider when Spectrum Cloud creds
 * are present, otherwise falls back to the projectless `terminal` provider so
 * the worker runs in local dev without creds.
 */
async function buildApp(cfg: MessagingConfig) {
  if (hasSpectrumCloud(cfg)) {
    console.log("[worker] starting Spectrum with the iMessage provider (cloud).");
    const app = await Spectrum({
      projectId: cfg.projectId!,
      projectSecret: cfg.projectSecret!,
      providers: [imessage.config()],
    });
    return { app, mode: "imessage" as const };
  }
  console.warn(
    "[worker] PROJECT_ID/PROJECT_SECRET not set — falling back to the projectless " +
      "`terminal` provider. Type into this terminal to simulate the marketer.",
  );
  const app = await Spectrum({ providers: [terminal.config()] });
  return { app, mode: "terminal" as const };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { app, mode } = await buildApp(cfg);
  const recorder = new ButterbaseRecorder(cfg.bbConfigured);

  const controller = new AbortController();
  const shutdown = (sig: string) => {
    console.log(`[worker] received ${sig}, shutting down…`);
    controller.abort();
    void app.stop().catch(() => {});
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  /**
   * Resolve the marketer's iMessage Space for relaying IG replies. Only works in
   * iMessage (cloud) mode with MARKETER_IMESSAGE set. Cached after first resolve.
   */
  let marketerSpace: Space | undefined;
  let marketerResolveTried = false;
  async function getMarketerSpace(): Promise<Space | undefined> {
    if (marketerSpace || marketerResolveTried) return marketerSpace;
    marketerResolveTried = true;
    if (mode !== "imessage") {
      console.warn("[worker] IG relay needs the iMessage provider; not in cloud mode.");
      return undefined;
    }
    if (!cfg.marketerImessage) {
      console.warn("[worker] MARKETER_IMESSAGE not set — cannot relay IG replies.");
      return undefined;
    }
    try {
      marketerSpace = await imessage(app).space({ phone: cfg.marketerImessage });
      return marketerSpace;
    } catch (err) {
      console.warn("[worker] could not resolve marketer iMessage space:", errText(err));
      return undefined;
    }
  }

  /** Handle one inbound influencer DM: record + relay to the marketer. */
  async function onInbound(msg: IgInboundMessage): Promise<void> {
    console.log(`[ig] inbound from ${msg.senderId}: ${truncate(msg.text)}`);
    await recorder.recordInbound(msg);
    const space = await getMarketerSpace();
    if (!space) return;
    const relay = `📩 @${msg.senderId} replied on Instagram:\n"${msg.text}"`;
    try {
      await space.send(relay);
    } catch (err) {
      console.warn("[worker] relay to marketer failed:", errText(err));
    }
  }

  // Loop 1: Spectrum inbound (the marketer over iMessage / terminal).
  async function spectrumLoop(): Promise<void> {
    console.log(`[worker] Spectrum message loop started (mode=${mode}).`);
    for await (const [space, message] of app.messages) {
      if (controller.signal.aborted) break;
      try {
        // The marketer messaging the agent. (`message.platform` is "iMessage" in
        // cloud mode, "Terminal" in fallback — both route to discovery here.)
        const text = textOf(message);
        if (text == null) continue;
        if (message.direction === "outbound") continue; // ignore our own echoes
        console.log(`[${message.platform}] marketer: ${truncate(text)}`);
        // Key the conversation on the stable Spectrum space id, so one iMessage
        // conversation maps to one continuous chat/context (XTrace conv_id).
        const convId = typeof space.id === "string" ? space.id : undefined;
        const result = await runDiscovery(text, convId);
        await space.send(composeReply(result.reply, result.top));
        // When discovery produced creators, follow up with a tappable panel card.
        await deliverPanelLink(space, result, cfg);
      } catch (err) {
        console.error("[worker] error handling inbound message:", errText(err));
      }
    }
    console.log("[worker] Spectrum message loop ended.");
  }

  // Loop 2: Instagram inbound poll (concurrent, decoupled from Spectrum).
  async function igLoop(): Promise<void> {
    await runInstagramChannel(
      { pollMs: cfg.igPollMs, onInbound, enabled: cfg.igConfigured },
      controller.signal,
    );
  }

  await Promise.all([spectrumLoop(), igLoop()]);
}

function truncate(s: string, n = 120): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
