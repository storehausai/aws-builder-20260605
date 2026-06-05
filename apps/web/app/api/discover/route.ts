import { NextResponse } from "next/server";
import { runDiscovery } from "@/lib/pipelines.server";
import { persistCandidates, tryCreateBb } from "@/lib/brand.server";
import { buildVisuals, type Visuals } from "@/lib/visuals.server";
import type { DiscoveryResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/discover  body { text, brandUrl?, storeId? }
 *   → { steps: string[], reply: string, influencers: InfluencerSuggestion[] }
 *
 * Runs discovery via `@pebble/pipelines`. When a storeId is supplied, the
 * returned influencers are persisted into `influencer_candidate`
 * (select-then-insert on store_id+handle, since there's no unique index).
 * Persistence is best-effort and never affects the response.
 */
export async function POST(req: Request) {
  let text = "";
  let brandUrl: string | undefined;
  let storeId: string | undefined;
  try {
    const body = (await req.json()) as {
      text?: string;
      brandUrl?: string;
      storeId?: string;
    };
    text = (body.text ?? "").trim();
    brandUrl = body.brandUrl?.trim() || undefined;
    storeId = body.storeId?.trim() || undefined;
  } catch {
    /* invalid body — fall through to validation */
  }

  if (!text) {
    if (brandUrl) {
      text = `Find the best influencers to promote ${brandUrl}.`;
    } else {
      return NextResponse.json(
        { error: "A discovery prompt (text) or brandUrl is required." },
        { status: 400 },
      );
    }
  }

  let result: DiscoveryResult;
  try {
    result = await runDiscovery({ text, brandUrl, storeId });
  } catch (err) {
    console.error("[/api/discover] unexpected error:", err);
    return NextResponse.json(
      { error: "Discovery failed. Please try again." },
      { status: 500 },
    );
  }

  // Best-effort persistence — never block or break the response.
  if (storeId && result.influencers.length) {
    const bb = tryCreateBb();
    if (bb) {
      try {
        await persistCandidates(bb, storeId, result.influencers);
      } catch (err) {
        console.warn("[/api/discover] candidate persistence failed:", err);
      }
    }
  }

  return NextResponse.json(result);
}
