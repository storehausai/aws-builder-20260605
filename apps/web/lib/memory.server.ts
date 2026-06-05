import { createMemory, type PebbleMemory } from "@pebble/memory";
import type { InfluencerSuggestion } from "@/lib/types";

/**
 * XTrace memory, wired into the agent's flow. Content is phrased FIRST-PERSON
 * (as the marketer speaking) because XTrace's fact-extractor only pulls durable
 * facts from conversational, first-person text — third-person statements yield
 * zero memories. Everything is best-effort and never blocks/breaks a request.
 */
let cached: PebbleMemory | null | undefined;

function mem(): PebbleMemory | null {
  if (cached !== undefined) return cached;
  if (!process.env.XTRACE_API_KEY || !process.env.XTRACE_ORG_ID) {
    cached = null;
    return null;
  }
  try {
    cached = createMemory(); // picks up XTRACE_API_URL/KEY/ORG_ID from env
  } catch {
    cached = null;
  }
  return cached;
}

/** On onboard: the agent learns the brand. */
export async function rememberBrand(
  storeId: string,
  brand: { name: string; category?: string; competitors?: string[] },
): Promise<void> {
  const m = mem();
  if (!m) return;
  const comp = (brand.competitors ?? []).slice(0, 6).join(", ");
  const brief =
    `I run influencer marketing for ${brand.name}` +
    (brand.category ? `, a US ${brand.category} brand` : "") +
    "." +
    (comp ? ` My main competitors are ${comp}.` : "");
  try {
    await m.writeBrandBrief(storeId, brief);
  } catch {
    /* best-effort */
  }
}

/** After discovery: the agent records which creators it found. */
export async function rememberDiscovery(
  storeId: string,
  brandName: string,
  influencers: InfluencerSuggestion[],
): Promise<void> {
  const m = mem();
  if (!m || influencers.length === 0) return;
  const top = influencers[0]!;
  const handles = influencers.slice(0, 5).map((i) => `@${i.handle}`).join(", ");
  const fact =
    `For ${brandName}, my market-mover analysis found these creators are the best fits: ${handles}. ` +
    `The strongest pick is @${top.handle}.`;
  try {
    await m.recordOutcome(storeId, fact);
  } catch {
    /* best-effort */
  }
}

/** After outreach: the agent records who it contacted. */
export async function rememberOutreach(storeId: string, handle: string, brand: string): Promise<void> {
  const m = mem();
  if (!m) return;
  try {
    await m.recordOutcome(storeId, `I reached out to @${handle} on Instagram for ${brand}.`);
  } catch {
    /* best-effort */
  }
}

/** Recall what the agent already knows about this brand for the current turn. */
export async function recallForStore(storeId: string, query: string): Promise<string> {
  const m = mem();
  if (!m) return "";
  try {
    return await m.recall(storeId, query);
  } catch {
    return "";
  }
}
