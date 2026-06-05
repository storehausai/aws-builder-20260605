import { NextResponse } from "next/server";
import { onboardFromUrl } from "@pebble/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tool endpoint called by RocketRide's `discovery.pipe` (t_ingest node). The
 * agent_rocketride orchestrator hits this to extract a brand from a homepage
 * URL. Keeps RocketRide as the orchestration layer while our provider does the
 * real work. Returns a compact, agent-friendly shape.
 */
export async function POST(req: Request) {
  let brandUrl = "";
  try {
    const body = (await req.json()) as { brandUrl?: string; url?: string; text?: string };
    brandUrl = (body.brandUrl ?? body.url ?? body.text ?? "").trim();
  } catch {
    /* fall through */
  }
  if (!brandUrl) {
    return NextResponse.json({ error: "brandUrl is required" }, { status: 400 });
  }
  const normalized = /^https?:\/\//i.test(brandUrl) ? brandUrl : `https://${brandUrl}`;
  try {
    const b = await onboardFromUrl(normalized);
    return NextResponse.json({
      brand: b.brand,
      category: b.category,
      competitors: b.competitors,
      seedAsins: b.seedAsins,
      summary: b.summary,
    });
  } catch (err) {
    return NextResponse.json({ error: `onboarding failed: ${(err as Error).message}` }, { status: 502 });
  }
}
