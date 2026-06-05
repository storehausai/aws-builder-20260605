/**
 * pollReplies — surface INBOUND Instagram DMs (the influencer's replies) for the
 * web chat, demo step 7. Wraps the active backend's inbox poll (web-graphql /
 * private) behind the stable pipelines contract.
 *
 * THROTTLE: the chat polls every few seconds, but we must NOT hit Instagram that
 * often (bot-flag risk). So we actually fetch the IG inbox at most once per
 * `IG_REPLY_THROTTLE_MS` (default 15s) and serve a process-cached result to the
 * frequent UI polls. The `_lastMs` guard is set BEFORE the await so concurrent
 * requests can't stampede a second fetch.
 */
import { backendFromEnv } from "@pebble/outreach";
import type { ReplyMessage } from "./types.js";

const THROTTLE_MS = Number(process.env.IG_REPLY_THROTTLE_MS ?? 15_000);

let lastFetchMs = 0;
let cache: ReplyMessage[] = [];

export async function pollReplies(sinceMs = 0): Promise<ReplyMessage[]> {
  const now = Date.now();
  if (now - lastFetchMs >= THROTTLE_MS) {
    lastFetchMs = now; // claim the slot before awaiting — prevents a poll stampede
    try {
      const backend = backendFromEnv();
      if (typeof backend.pollInbound === "function") {
        const msgs = await backend.pollInbound(0);
        cache = msgs.map((m) => ({
          id: `ig-${m.threadId}-${m.timestamp}`,
          handle: (m.senderHandle ?? m.senderId).replace(/^@/, ""),
          body: m.text,
          channel: "instagram" as const,
          sentAt: new Date(m.timestamp).toISOString(),
        }));
      }
    } catch (err) {
      // Keep the previous cache on a transient failure; never throw to the UI.
      console.warn("[pollReplies] IG inbox poll failed:", err instanceof Error ? err.message : err);
    }
  }
  return sinceMs ? cache.filter((r) => Date.parse(r.sentAt) > sinceMs) : cache;
}
