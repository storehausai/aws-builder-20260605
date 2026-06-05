import { NextResponse } from "next/server";
import { listCandidates } from "@/lib/brand.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/influencers?storeId=…
 *   → { influencers: StoredInfluencer[] }
 *
 * Lists the persisted influencer candidates for a store (best-fit first).
 * Backs the Influencers sidebar tab. Never throws — returns [] on any failure.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get("storeId")?.trim();
  if (!storeId) {
    return NextResponse.json(
      { error: "A storeId query param is required." },
      { status: 400 },
    );
  }

  const influencers = await listCandidates(storeId);
  return NextResponse.json({ influencers });
}
