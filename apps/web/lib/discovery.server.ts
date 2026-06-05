import { runDiscovery } from "@/lib/pipelines.server";
import { persistCandidates, tryCreateBb } from "@/lib/brand.server";
import { buildVisuals, type Visuals } from "@/lib/visuals.server";
import { recallForStore, rememberDiscovery } from "@/lib/memory.server";
import type { DiscoveryResult } from "@/lib/types";

export interface EnrichedDiscovery extends DiscoveryResult {
  visuals?: Visuals;
  memory?: string;
}

/**
 * Run discovery AND enrich it the same way `/api/discover` does — persist
 * candidates, build visuals (logos, BSR chart, real avatars), recall + write
 * XTrace memory. Shared by the discover route and the chat agent's
 * `find_influencers` tool so both behave identically.
 */
export async function discoverEnriched(input: {
  text: string;
  brandUrl?: string;
  storeId?: string;
}): Promise<EnrichedDiscovery> {
  const text =
    input.text?.trim() ||
    (input.brandUrl ? `Find the best influencers to promote ${input.brandUrl}.` : "");

  const result = await runDiscovery({ text, brandUrl: input.brandUrl, storeId: input.storeId });

  // Best-effort persistence — never block the response.
  if (input.storeId && result.influencers.length) {
    const bb = tryCreateBb();
    if (bb) {
      try {
        await persistCandidates(bb, input.storeId, result.influencers);
      } catch (err) {
        console.warn("[discoverEnriched] candidate persistence failed:", err);
      }
    }
  }

  let visuals: Visuals | undefined;
  let memory = "";
  try {
    [visuals, memory] = await Promise.all([
      buildVisuals({ storeId: input.storeId, brandUrl: input.brandUrl, influencers: result.influencers }),
      input.storeId ? recallForStore(input.storeId, text) : Promise.resolve(""),
    ]);
  } catch (err) {
    console.warn("[discoverEnriched] enrichment failed:", err);
  }

  if (input.storeId && result.influencers.length) {
    void rememberDiscovery(
      input.storeId,
      visuals?.brand?.name ?? input.brandUrl ?? "your brand",
      result.influencers,
    );
  }

  return { ...result, visuals, memory: memory || undefined };
}
