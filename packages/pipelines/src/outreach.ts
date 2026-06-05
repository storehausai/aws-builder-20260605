/**
 * runOutreach — steps 5-7: compose a short personalized DM, then send it for real.
 *
 *   1. Compose the DM via the Butterbase AI gateway (chatText), unless a `draft`
 *      is supplied.
 *   2. Send it via @pebble/outreach `backendFromEnv().sendText(handle, message)`.
 *      `delivered` mirrors the send result `.ok`.
 *
 * If Instagram isn't configured (or the send throws), we return
 * `{ ok: true, delivered: false, message }` — composed but not sent. Never throws.
 */
import { createBb, chatText, FAST_MODEL } from "@pebble/bb";
import { backendFromEnv } from "@pebble/outreach";
import type { OutreachInput, OutreachResult } from "./types.js";

const SYSTEM = [
  "You are Pebble, writing an outreach Instagram DM on behalf of a brand.",
  "Write ONE short, warm, personalized message — under 300 characters, no hashtags,",
  "no emoji spam, human and specific. Reference why this creator fits the brand.",
  "Output ONLY the message text, nothing else.",
].join("\n");

async function composeMessage(input: OutreachInput): Promise<string> {
  if (input.draft && input.draft.trim()) return input.draft.trim();
  const bb = createBb();
  const brand = input.brand?.trim() || "our brand";
  const user = [
    `Creator: @${input.handle}`,
    `Brand: ${brand}`,
    "Write the DM now.",
  ].join("\n");
  const text = await chatText(bb, SYSTEM, user, { model: FAST_MODEL });
  return text.trim();
}

/** Whether the Instagram backend has the credentials it needs to send. */
function instagramConfigured(env = process.env): boolean {
  const backend = (env.IG_BACKEND ?? "private").toLowerCase();
  if (backend === "graph") return Boolean(env.IG_ACCESS_TOKEN);
  if (backend === "web" || backend === "web-graphql") return Boolean(env.IG_SESSIONID);
  return Boolean(env.IG_USERNAME && env.IG_PASSWORD);
}

/** Built-in template DM, used when the AI compose step fails. */
function templateMessage(input: OutreachInput): string {
  const brand = input.brand?.trim() || "our brand";
  return `Hi @${input.handle} — we love what you're doing and think you'd be a great fit for ${brand}. Would you be open to a quick collab chat?`;
}

/**
 * runOutreach — never throws; returns an OutreachResult.
 */
export async function runOutreach(input: OutreachInput): Promise<OutreachResult> {
  const handle = input.handle.replace(/^@/, "").trim();

  // 1. Compose (or accept a draft). Degrade to a template if the AI call fails.
  let message: string;
  try {
    message = await composeMessage({ ...input, handle });
    if (!message) message = templateMessage({ ...input, handle });
  } catch {
    message = templateMessage({ ...input, handle });
  }

  // 2a. If Instagram isn't connected, don't try to send — ask the user to
  //     connect it (demo step 5). We still return the composed DM to show.
  if (!instagramConfigured()) {
    return {
      ok: true,
      channel: "instagram",
      handle,
      message,
      delivered: false,
      needsConnection: "instagram",
      error: "Instagram isn't connected yet — connect it to send this DM.",
    };
  }

  // 2b. Send for real via @pebble/outreach. If the send throws, return
  //     composed-but-not-delivered rather than throwing.
  try {
    const backend = backendFromEnv();
    const r = await backend.sendText(handle, message);
    return {
      ok: true,
      channel: "instagram",
      handle,
      message,
      delivered: r.ok,
      threadId: r.messageId,
      error: r.ok ? undefined : r.error,
    };
  } catch (err) {
    return {
      ok: true,
      channel: "instagram",
      handle,
      message,
      delivered: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
