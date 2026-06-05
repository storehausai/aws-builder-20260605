import { NextResponse } from "next/server";
import { listInfluencerMessages } from "@/lib/brand.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/influencers/[id]/messages?storeId=…
 *   → { messages: OutreachMessage[] }
 *
 * Returns the full outreach conversation (outbound DMs + inbound replies) for
 * one influencer candidate, oldest first. Backs the influencer detail drawer.
 * Never throws — returns [] on any failure.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get("storeId")?.trim();
  if (!storeId) {
    return NextResponse.json(
      { error: "A storeId query param is required." },
      { status: 400 },
    );
  }

  const messages = await listInfluencerMessages(storeId, id);
  return NextResponse.json({ messages });
}
