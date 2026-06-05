import { NextResponse } from "next/server";
import { fetchReplies, type ReplyRecord } from "@/lib/replies.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/replies?storeId=<id>&since=<iso?>
 *   → { replies: Array<{ id, handle?, body, channel, sent_at, sentAt }> }
 *
 * Reads recent inbound outreach_message rows (joined to threads/candidates) for
 * the store. Returns [] gracefully when there are none or Butterbase is
 * unconfigured — the polling client never sees a crash.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get("storeId") ?? undefined;
  const since = searchParams.get("since") ?? undefined;

  try {
    const replies: ReplyRecord[] = await fetchReplies(storeId, since);
    return NextResponse.json({ replies });
  } catch (err) {
    console.error("[/api/replies] unexpected error:", err);
    // Never surface a crash to the polling client.
    return NextResponse.json({ replies: [] as ReplyRecord[] });
  }
}
