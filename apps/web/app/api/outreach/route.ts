import { NextResponse } from "next/server";
import { runOutreach } from "@/lib/pipelines.server";
import { persistOutreach } from "@/lib/brand.server";
import { rememberOutreach } from "@/lib/memory.server";
import type { OutreachResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/outreach  body { handle, draft?, brand?, storeId? }
 *   → OutreachResult from `@pebble/pipelines` runOutreach (incl. needsConnection?)
 *
 * When storeId is given we best-effort record an outreach_thread +
 * outreach_message. The candidate is find-or-created (ensureCandidate) so any
 * creator we DM lands on the Influencers CRM tab even if discovery never ran.
 * A blocked send (needsConnection) never went out, so it creates nothing.
 */
export async function POST(req: Request) {
  let handle = "";
  let draft: string | undefined;
  let brand: string | undefined;
  let storeId: string | undefined;
  try {
    const body = (await req.json()) as {
      handle?: string;
      draft?: string;
      brand?: string;
      storeId?: string;
    };
    handle = (body.handle ?? "").trim();
    draft = body.draft?.trim() || undefined;
    brand = body.brand?.trim() || undefined;
    storeId = body.storeId?.trim() || undefined;
  } catch {
    /* fall through to validation */
  }

  if (!handle) {
    return NextResponse.json(
      { error: "A creator handle is required." },
      { status: 400 },
    );
  }

  let result: OutreachResult;
  try {
    result = await runOutreach({ handle, draft, brand, storeId });
  } catch (err) {
    console.error("[/api/outreach] unexpected error:", err);
    const fallback: OutreachResult = {
      ok: false,
      channel: "instagram",
      handle,
      message: draft ?? "",
      delivered: false,
      error: "Outreach failed. Please try again.",
    };
    return NextResponse.json(fallback, { status: 200 });
  }

  // Best-effort CRM record — never affects the returned result.
  await persistOutreach(storeId, handle, result);

  // Record the outreach into the agent's XTrace memory (best-effort, non-blocking).
  if (storeId) void rememberOutreach(storeId, handle, brand ?? "your brand");

  return NextResponse.json(result);
}
