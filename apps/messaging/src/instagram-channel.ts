/**
 * Instagram inbound channel — a standalone concurrent poll loop.
 *
 * DESIGN DECISION: concurrent-poll, NOT spectrum-ts `definePlatform`.
 * -----------------------------------------------------------------------------
 * spectrum-ts v1.18.0 *does* expose `definePlatform`, but wiring Instagram in as
 * a real Spectrum provider is non-trivial: `definePlatform` expects zod config/
 * user/space/message schemas, a `createClient`, a `messages` async generator,
 * `send` actions, etc., and the provider has to be registered with a running
 * `Spectrum(...)` instance. Instagram is not a built-in provider and our IG
 * access is a private-api inbox poll (no webhook, no realtime stream). Per the
 * task guidance ("keep the simple concurrent-poll approach … preferred if
 * definePlatform is unclear — don't over-engineer"), we run IG as a separate
 * async loop alongside the Spectrum `for await (...)` loop via `Promise.all`.
 * This keeps the IG concern fully decoupled from Spectrum and trivially
 * resilient: a bad poll is caught and the loop simply waits for the next tick.
 *
 * On each new inbound influencer DM we invoke a caller-supplied handler (which
 * records it to Butterbase and relays it to the marketer over iMessage).
 */
import { requirePoller, type IgInboundMessage } from "@pebble/outreach";

export type InboundHandler = (msg: IgInboundMessage) => Promise<void>;

export interface InstagramChannelOptions {
  /** Poll interval in ms. */
  pollMs: number;
  /** Invoked once per newly-seen inbound message. */
  onInbound: InboundHandler;
  /** Whether IG credentials are configured. If false the loop idles. */
  enabled: boolean;
}

/**
 * Start the IG inbound poll loop. Resolves only when `signal` aborts. Never
 * rejects — every error is caught and logged so it can't take down the worker.
 */
export async function runInstagramChannel(
  opts: InstagramChannelOptions,
  signal: AbortSignal,
): Promise<void> {
  if (!opts.enabled) {
    console.warn(
      "[ig] IG_USERNAME/IG_PASSWORD not set — Instagram relay disabled. " +
        "The iMessage loop will keep running.",
    );
    return;
  }

  let backend: ReturnType<typeof requirePoller>;
  try {
    backend = requirePoller();
  } catch (err) {
    console.warn("[ig] could not init IG poller backend:", errText(err), "— relay disabled.");
    return;
  }

  // Track the high-water timestamp so each poll only surfaces newer messages.
  // pollInbound already filters `ts <= sinceMs`, so this naturally dedupes.
  let sinceMs = Date.now();
  console.log(`[ig] inbound poll loop started (every ${opts.pollMs}ms).`);

  while (!signal.aborted) {
    try {
      const msgs = await backend.pollInbound(sinceMs);
      for (const msg of msgs) {
        if (msg.timestamp > sinceMs) sinceMs = msg.timestamp;
        try {
          await opts.onInbound(msg);
        } catch (err) {
          console.error("[ig] inbound handler failed:", errText(err));
        }
      }
    } catch (err) {
      // Login challenge, network blip, not-logged-in, etc. Log and keep going.
      console.warn("[ig] poll failed (will retry):", errText(err));
    }
    await sleep(opts.pollMs, signal);
  }
  console.log("[ig] inbound poll loop stopped.");
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
