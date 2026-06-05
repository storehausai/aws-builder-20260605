import { NextResponse } from "next/server";
import { onboardFromUrl } from "@pebble/providers";
import {
  ensureStore,
  persistBrandProfile,
  slugFromUrl,
  toBrandPayload,
  tryCreateBb,
  type BrandPayload,
} from "@/lib/brand.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/onboard  body { brandUrl }
 *   → { storeId, brand: { name, category, summary, competitors[], seedAsins[], homepageUrl } }
 *
 * Real homepage fetch + AI extraction via `onboardFromUrl`, then upsert a
 * `stores` row (by slug) and persist its `brand_profile`. Persistence is
 * best-effort: even if Butterbase is unconfigured/erroring we still return the
 * extracted brand (with `storeId: null`).
 */
export async function POST(req: Request) {
  let brandUrl = "";
  try {
    const body = (await req.json()) as { brandUrl?: string };
    brandUrl = (body.brandUrl ?? "").trim();
  } catch {
    /* invalid body — fall through to validation */
  }

  if (!brandUrl) {
    return NextResponse.json(
      { error: "A brand homepage URL is required." },
      { status: 400 },
    );
  }

  let brand: BrandPayload;
  try {
    const onboarding = await onboardFromUrl(brandUrl);
    brand = toBrandPayload(onboarding);
  } catch (err) {
    console.error("[/api/onboard] onboarding failed:", err);
    return NextResponse.json(
      { error: "Could not analyze that brand homepage. Please try again." },
      { status: 502 },
    );
  }

  // Persist best-effort — never let a DB hiccup fail the onboarding response.
  let storeId: string | null = null;
  const bb = tryCreateBb();
  if (bb) {
    try {
      const slug = slugFromUrl(brand.homepageUrl || brandUrl);
      storeId = await ensureStore(bb, { slug, name: brand.name });
      await persistBrandProfile(bb, storeId, brand);
    } catch (err) {
      console.warn("[/api/onboard] persistence failed (non-fatal):", err);
    }
  }

  return NextResponse.json({ storeId, brand });
}
