/**
 * Best-effort recording of inbound influencer DMs to Butterbase.
 *
 * Writes an `outreach_message` row (direction=inbound, channel=instagram). That
 * table has a NOT NULL `thread_id` FK into `outreach_thread`, so we first try to
 * resolve the thread by the IG thread id captured on the inbound message. If no
 * thread exists yet (e.g. the reply arrived before the outbound send was
 * persisted) we log and skip the DB write rather than crash — the relay to the
 * marketer still happens regardless.
 *
 * The whole module is defensive: if Butterbase isn't configured or any call
 * fails, we warn and move on. A bad write must never kill the worker.
 */
import { createBb, insertReturning, unwrapMaybe, type Bb } from "@pebble/bb";
import type { IgInboundMessage } from "@pebble/outreach";

export class ButterbaseRecorder {
  private bb: Bb | null = null;
  private disabled = false;

  constructor(private readonly enabled: boolean) {
    if (!enabled) this.disabled = true;
  }

  private client(): Bb | null {
    if (this.disabled) return null;
    if (this.bb) return this.bb;
    try {
      this.bb = createBb();
      return this.bb;
    } catch (err) {
      console.warn(
        "[bb] Butterbase not configured; skipping message recording:",
        errText(err),
      );
      this.disabled = true;
      return null;
    }
  }

  /** Resolve an `outreach_thread.id` from the inbound's IG thread id. */
  private async resolveThreadId(bb: Bb, igThreadId: string): Promise<string | null> {
    try {
      const row = unwrapMaybe(
        await bb
          .from("outreach_thread")
          .select("id")
          .eq("ig_thread_id", igThreadId)
          .maybeSingle(),
      ) as { id?: string } | null;
      return row?.id ?? null;
    } catch (err) {
      console.warn("[bb] thread lookup failed:", errText(err));
      return null;
    }
  }

  /**
   * Record an inbound influencer DM. Returns true if a row was written. Never
   * throws.
   */
  async recordInbound(msg: IgInboundMessage): Promise<boolean> {
    const bb = this.client();
    if (!bb) return false;
    try {
      const threadId = await this.resolveThreadId(bb, msg.threadId);
      if (!threadId) {
        console.warn(
          `[bb] no outreach_thread for ig_thread_id=${msg.threadId}; ` +
            "skipping outreach_message insert (relay still sent).",
        );
        return false;
      }
      await insertReturning(bb, "outreach_message", {
        thread_id: threadId,
        direction: "inbound",
        channel: "instagram",
        body: msg.text,
      });
      return true;
    } catch (err) {
      console.warn("[bb] recordInbound failed:", errText(err));
      return false;
    }
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
