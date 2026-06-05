import { NextResponse } from "next/server";
import { runDiscovery } from "@/lib/pipelines.server";
import {
  getBrandProfile,
  getFreshCandidates,
  persistCandidates,
  tryCreateBb,
} from "@/lib/brand.server";
import { buildVisuals, type Visuals } from "@/lib/visuals.server";
import { recallForStore, rememberDiscovery } from "@/lib/memory.server";
import type { DiscoveryResult, InfluencerSuggestion } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// How long a store's saved discovery is reused before we re-run the (paid) Apify
// search. Override via DISCOVERY_TTL_HOURS; 0 disables the cache (always fresh).
const DISCOVERY_TTL_MS = (Number(process.env.DISCOVERY_TTL_HOURS ?? 24)) * 3_600_000;
// Minimum saved candidates required to serve from cache instead of re-searching.
const MIN_CACHED = 3;

/**
 * Build a DiscoveryResult from saved candidates (the read-before-fetch path), so
 * a repeat discovery returns instantly without spending an Apify search. The
 * narrated steps make the reuse explicit in the chat.
 */
function cachedDiscovery(
  influencers: InfluencerSuggestion[],
  brandName: string,
): DiscoveryResult {
  const top = influencers.slice(0, 6);
  return {
    steps: [
      `Recalling your saved analysis for ${brandName}…`,
      `Reusing ${influencers.length} creators already vetted by the burst-attribution run (cached — no re-scrape).`,
      `Re-ranking by market-mover fit and refreshing their profiles.`,
    ],
    reply:
      `Here are the top ${top.length} creators from your saved analysis of ${brandName} — ` +
      `surfaced earlier by the burst→content attribution and cached, so this is instant. ` +
      `Say **"run a fresh search"** if you want me to scan for new market movers.`,
    influencers: top,
  };
}

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

  // The marketer can force a fresh (paid) search with an explicit phrase.
  const forceFresh = /\b(fresh|re-?run|re-?search|new search|refresh)\b/i.test(text);

  // READ-BEFORE-FETCH: serve saved candidates and skip Apify when we have a fresh
  // enough shortlist for this store. This is the main Apify-credit saver.
  // getFreshCandidates never throws (returns [] on any failure).
  const cached =
    storeId && DISCOVERY_TTL_MS > 0 && !forceFresh
      ? await getFreshCandidates(storeId, DISCOVERY_TTL_MS)
      : [];

  let result: DiscoveryResult;
  if (cached.length >= MIN_CACHED && storeId) {
    const bp = await getBrandProfile(storeId);
    result = cachedDiscovery(cached, bp?.name || brandUrl || "your brand");
    console.log(`[/api/discover] served ${cached.length} candidates from cache (no Apify spend).`);
  } else {
    try {
      result = await runDiscovery({ text, brandUrl, storeId });
    } catch (err) {
      console.error("[/api/discover] unexpected error:", err);
      return NextResponse.json(
        { error: "Discovery failed. Please try again." },
        { status: 500 },
      );
    }

    // Best-effort persistence — never block or break the response. (Skipped on
    // the cache path: those candidates are already saved.)
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
  }

  // Recall what the agent already knows about this brand (XTrace) + enrich with
  // visual data (logos, BSR chart, real IG avatars). Both best-effort.
  let visuals: Visuals | undefined;
  let memory = "";
  try {
    [visuals, memory] = await Promise.all([
      buildVisuals({ storeId, brandUrl, influencers: result.influencers }),
      storeId ? recallForStore(storeId, text) : Promise.resolve(""),
    ]);
  } catch (err) {
    console.warn("[/api/discover] enrichment failed:", err);
  }

  // Unify the chart with the influencers: show the COMPETITOR product whose real
  // sales-rank burst drove this discovery (with its price line), overriding the
  // engine/fixtures chart of the user's own brand.
  if (result.chart) {
    const c = result.chart;
    visuals = visuals ?? {};
    visuals.chart = {
      points: c.points,
      productTitle: c.productTitle,
      competitor: c.competitor,
      productImage: c.productImage ? `/api/img?u=${encodeURIComponent(c.productImage)}` : undefined,
      rankFrom: c.rankFrom,
      rankTo: c.rankTo,
      date: c.date,
    };
  }

  // Record this discovery into the agent's memory for next time (don't block).
  if (storeId && result.influencers.length) {
    void rememberDiscovery(storeId, visuals?.brand?.name ?? brandUrl ?? "your brand", result.influencers);
  }

  return NextResponse.json({ ...result, visuals, memory: memory || undefined });
}
