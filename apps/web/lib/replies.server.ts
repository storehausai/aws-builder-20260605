import { createBb } from "@pebble/bb";

/**
 * Reads recent INBOUND outreach messages from Butterbase so the chat can show
 * "📩 @handle replied: …". If Butterbase isn't configured (no app id / service
 * key) or the query fails, this returns an empty list — the demo never crashes.
 *
 * Schema (butterbase/schema.json):
 *   outreach_message(id, thread_id, direction, channel, body, sent_at)
 *   outreach_thread (id, candidate_id, store_id, ig_thread_id, state, …)
 *   influencer_candidate(id, store_id, handle, …)   ← handle source
 *
 * The returned items are a SUPERSET that satisfies both the API contract
 * (`{ handle?, body, sent_at }`) and the in-app `ReplyItem` shape the chat UI
 * consumes (`{ id, handle, body, sentAt, channel }`).
 */
export interface ReplyRecord {
  id: string;
  handle: string;
  body: string;
  channel: string;
  /** ISO timestamp (contract field). */
  sent_at: string;
  /** Same value as sent_at, camelCase alias for the chat UI. */
  sentAt: string;
}

export async function fetchReplies(
  storeId?: string,
  sinceIso?: string,
): Promise<ReplyRecord[]> {
  // When the web-graphql IG backend is active, surface replies LIVE from the IG
  // inbox (throttled in @pebble/pipelines) so demo step 7 works without the
  // messaging worker or Butterbase. Falls through to Butterbase otherwise.
  const live = await fetchRepliesLive(sinceIso);
  if (live !== null) return live;

  if (
    !process.env.BUTTERBASE_APP_ID &&
    !process.env.NEXT_PUBLIC_BUTTERBASE_APP_ID
  ) {
    return [];
  }

  let bb;
  try {
    bb = createBb();
  } catch {
    return [];
  }

  try {
    // Pull recent inbound messages, joining the thread (for store scoping) and
    // the candidate (for the handle). Degrades gracefully if the embed fails.
    let query = bb
      .from("outreach_message")
      .select(
        "id, body, channel, sent_at, direction, thread_id, outreach_thread(store_id, ig_thread_id, influencer_candidate(handle))",
      )
      .eq("direction", "inbound")
      .order("sent_at", { ascending: false })
      .limit(25);

    if (sinceIso) query = query.gt("sent_at", sinceIso);

    const res = await query;
    if (res.error || !Array.isArray(res.data)) {
      // Fall back to an embed-free read so a join issue doesn't kill replies.
      return await fetchRepliesFlat(bb, storeId, sinceIso);
    }

    const rows = res.data as RawRow[];
    return rows
      .filter((r) => !storeId || r.outreach_thread?.store_id === storeId)
      .map(toReplyRecord);
  } catch {
    try {
      return await fetchRepliesFlat(bb, storeId, sinceIso);
    } catch {
      return [];
    }
  }
}

/**
 * Live IG-inbox path. Returns null when the web-graphql backend isn't active
 * (so the caller falls back to Butterbase). The actual IG fetch is throttled
 * inside @pebble/pipelines, so frequent chat polls don't hammer Instagram.
 */
async function fetchRepliesLive(sinceIso?: string): Promise<ReplyRecord[] | null> {
  const backend = (process.env.IG_BACKEND ?? "").toLowerCase();
  if ((backend !== "web" && backend !== "web-graphql") || !process.env.IG_SESSIONID) {
    return null;
  }
  try {
    const mod = (await import("@pebble/pipelines")) as {
      pollReplies?: (sinceMs?: number) => Promise<
        Array<{ id: string; handle: string; body: string; channel: string; sentAt: string }>
      >;
    };
    if (typeof mod.pollReplies !== "function") return null;
    const sinceMs = sinceIso ? Date.parse(sinceIso) : 0;
    const msgs = await mod.pollReplies(Number.isNaN(sinceMs) ? 0 : sinceMs);
    return msgs.map((m) => ({
      id: m.id,
      handle: m.handle,
      body: m.body,
      channel: m.channel,
      sent_at: m.sentAt,
      sentAt: m.sentAt,
    }));
  } catch (err) {
    console.warn("[replies] live IG poll failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Embed-free fallback: just the message rows (no handle resolution). */
async function fetchRepliesFlat(
  bb: ReturnType<typeof createBb>,
  storeId?: string,
  sinceIso?: string,
): Promise<ReplyRecord[]> {
  let query = bb
    .from("outreach_message")
    .select("id, body, channel, sent_at, direction")
    .eq("direction", "inbound")
    .order("sent_at", { ascending: false })
    .limit(25);
  if (sinceIso) query = query.gt("sent_at", sinceIso);
  const res = await query;
  if (res.error || !Array.isArray(res.data)) return [];
  // No thread join here → cannot scope by store; only used as a last resort.
  if (storeId) return [];
  return (res.data as RawRow[]).map(toReplyRecord);
}

interface RawRow {
  id: string;
  body?: string | null;
  channel?: string | null;
  sent_at?: string | null;
  thread_id?: string | null;
  outreach_thread?: {
    store_id?: string | null;
    ig_thread_id?: string | null;
    influencer_candidate?: { handle?: string | null } | null;
  } | null;
}

function toReplyRecord(r: RawRow): ReplyRecord {
  const handle = (
    r.outreach_thread?.influencer_candidate?.handle ??
    r.outreach_thread?.ig_thread_id ??
    "creator"
  ).replace(/^@/, "");
  const sentAt = r.sent_at ?? new Date().toISOString();
  return {
    id: r.id,
    handle,
    body: r.body ?? "",
    channel: r.channel ?? "instagram",
    sent_at: sentAt,
    sentAt,
  };
}
