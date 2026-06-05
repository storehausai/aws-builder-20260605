import { NextResponse } from "next/server";
import { runPanel } from "@/lib/pipelines.server";
import type { InfluencerSuggestion, PanelResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/generate-panel
 *
 * The AI dashboard "artifact" — given the discovery output (brand + ranked
 * influencers), the agent grounds a data bundle and writes a complete,
 * self-contained HTML document. The client renders it in a sandboxed
 * <iframe srcDoc>. Never errors out: `runPanel` always returns grounded HTML.
 */
export async function POST(req: Request) {
  let brand: string | undefined;
  let brandUrl: string | undefined;
  let influencers: InfluencerSuggestion[] = [];
  try {
    const body = (await req.json()) as {
      brand?: string;
      brandUrl?: string;
      influencers?: InfluencerSuggestion[];
    };
    brand = body.brand?.trim() || undefined;
    brandUrl = body.brandUrl?.trim() || undefined;
    influencers = Array.isArray(body.influencers) ? body.influencers : [];
  } catch {
    /* fall through with defaults */
  }

  const result: PanelResult = await runPanel({ brand, brandUrl, influencers });
  return NextResponse.json(result);
}
