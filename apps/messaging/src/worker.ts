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
import { Spectrum, type Space, type Message } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { terminal } from "spectrum-ts/providers/terminal";
import type { IgInboundMessage } from "@pebble/outreach";

import { loadConfig, hasSpectrumCloud, type MessagingConfig } from "./config.js";
import { runDiscovery, type DiscoveryResult } from "./discovery.js";
import { ButterbaseRecorder } from "./butterbase-recorder.js";
import { runInstagramChannel } from "./instagram-channel.js";

/** Pull plain text out of an inbound message's content union, if any. */
function textOf(message: Message): string | undefined {
  const c = message.content;
  return c.type === "text" ? c.text : undefined;
}

/**
 * Render a discovery result as iMessage text that mirrors the dashboard chat:
 * the agent's prose reply, followed by the same ranked creator shortlist the
 * dashboard shows beside the conversation — handle, fit score, and rationale.
 * iMessage is text-only, so the dashboard's creator "cards" become numbered
 * lines, but the content and ordering are identical.
 */
function formatReply(result: DiscoveryResult): string {
  const lines: string[] = [result.reply.trim()];
  const creators = result.influencers ?? [];
  if (creators.length > 0) {
    lines.push("");
    creators.slice(0, 6).forEach((c, i) => {
      const fit =
        typeof c.score === "number" ? ` · ${Math.round(c.score * 100)}% fit` : "";
      lines.push(`${i + 1}. @${c.handle}${fit}`);
      if (c.rationale) lines.push(`   ${c.rationale}`);
    });
  }
  return lines.join("\n");
}

const STEP_REVEAL_MS = 800;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Replay the agent's narrated work as interim iMessage texts, one per step with
 * a short pause between — the text-conversation analogue of the dashboard
 * revealing its steps one-at-a-time beside the chat. Aborts cleanly on shutdown.
 */
async function revealSteps(
  space: Space,
  steps: string[] | undefined,
  signal: AbortSignal,
): Promise<void> {
  for (const step of steps ?? []) {
    if (signal.aborted) return;
    const line = step.trim();
    if (!line) continue;
    await space.send(line);
    await sleep(STEP_REVEAL_MS);
  }
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
        // Immediate ack so the (real, ~1–2 min) discovery wait isn't silent —
        // the dashboard's equivalent is its loading state.
        await space.send("On it — finding creators for you… (about a minute)");
        // Ground on the same brand the dashboard uses, so the iMessage reply
        // matches the dashboard chat instead of falling back to "the brand".
        const result = await runDiscovery(text, {
          convId,
          storeId: cfg.marketerStoreId,
          brandUrl: cfg.marketerBrandUrl,
        });
        // Replay the agent's work as interim texts (the dashboard reveals these
        // beside the chat), then send the final grounded reply + creators.
        await revealSteps(space, result.steps, controller.signal);
        await space.send(formatReply(result));
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
