import { NextResponse } from "next/server";
import { getBrandProfile } from "@/lib/brand.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/brand?storeId=<id>
 *   → { brand: { name, category, summary, competitors, seedAsins, homepageUrl } | null }
 *
 * Reads the latest brand_profile for the store. Returns { brand: null } when
 * there's no storeId, no profile, or Butterbase is unconfigured — never errors.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const storeId = (searchParams.get("storeId") ?? "").trim();

  if (!storeId) {
    return NextResponse.json({ brand: null });
  }

  try {
    const brand = await getBrandProfile(storeId);
    return NextResponse.json({ brand });
  } catch (err) {
    console.error("[/api/brand] unexpected error:", err);
    return NextResponse.json({ brand: null });
  }
}
