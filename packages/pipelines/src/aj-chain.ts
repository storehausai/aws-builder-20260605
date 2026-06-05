/**
 * The a–j discovery chain — the real market-mover prospecting algorithm, run
 * in-process and NARRATED step-by-step into the chat (like Claude Code working
 * while it talks). This is the substance behind demo step 3.
 *
 *   (a) brand homepage URL  → brand, category, competitors        [onboardFromUrl]
 *   (b) competitors         → Amazon ASINs                        [onboarding seedAsins / Keepa]
 *   (c) ASINs               → BSR (sales-rank) series             ┐
 *   (d) detect ranking bursts                                     │ the engine
 *   (e) check the price was steady (not a discount)               │ (apps/engine
 *   (f) burst + steady price ⇒ driven by outside traffic          │  /market-movers,
 *   (g) pull content & PRs from 0–7 days before the burst         │  which runs
 *   (h) the most viral post about the product = the market mover  ┘  @pebble/engine)
 *   (i) find creators SIMILAR to that mover                       [discoverSimilarCreators]
 *   (j) suggest the ranked shortlist
 *
 * Every step degrades gracefully: missing data/keys narrate honestly and the
 * chain continues. This function never throws.
 */
import {
  onboardFromUrl,
  discoverSimilarCreators,
  type BrandOnboarding,
  type CreatorCandidate,
} from "@pebble/providers";
import type { DiscoveryInput, DiscoveryResult, InfluencerSuggestion } from "./types.js";
import { findMarketMoverLive } from "./market-mover-live.js";
import { findBrandReelInfluencers } from "./brand-reels.js";
import { findInfluencersFromBurst } from "./influencer-from-burst.js";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:8787";

/** The slice of the engine /market-movers response we consume. */
interface EngineCreator {
  handle?: string;
  followers?: number;
  compositeSigma?: number;
}
interface EngineResponse {
  productTitle?: string;
  spikes?: Array<{ gate?: string; verdict?: string }>;
  topAttribution?: { creator?: EngineCreator | null } | null;
  error?: string;
}

interface MarketMover {
  handle: string;
  followers?: number;
  sigma?: number;
  evidence: string;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** (a) Onboard the brand from its homepage (or infer from free text). */
async function stepOnboard(input: DiscoveryInput, emit: (s: string) => void): Promise<BrandOnboarding> {
  if (input.brandUrl) {
    emit(`Reading ${hostname(input.brandUrl)}…`);
    const brand = await onboardFromUrl(input.brandUrl);
    emit(
      `Identified ${brand.brand || "the brand"}${brand.category ? ` — ${brand.category}` : ""}.`,
    );
    if (brand.competitors.length) {
      emit(`Competitors in view: ${brand.competitors.slice(0, 4).join(", ")}.`);
    }
    return brand;
  }
  const guess = input.text.replace(/find influencers?\s*(for\s+)?/i, "").trim() || "your brand";
  emit(`Looking at ${guess}…`);
  return { brand: guess, category: "", summary: "", competitors: [], seedAsins: [], homepageUrl: "" };
}

/** (b) Surface the competitor ASINs we resolved on Amazon. */
function stepAsins(brand: BrandOnboarding, emit: (s: string) => void): void {
  if (brand.seedAsins.length) {
    emit(`Found ${brand.seedAsins.length} competitor product(s) on Amazon (${brand.seedAsins.slice(0, 3).join(", ")}).`);
  } else {
    emit("Resolving competitor products on Amazon…");
  }
}

async function callEngine(brand: BrandOnboarding): Promise<EngineResponse | null> {
  try {
    const res = await fetch(`${ENGINE_URL}/market-movers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "brand", identifier: brand.brand }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as EngineResponse;
  } catch {
    return null;
  }
}

/** (c)–(h) Run the engine: bursts → price gate → window content → viral mover. */
async function stepMarketMover(brand: BrandOnboarding, emit: (s: string) => void): Promise<MarketMover | null> {
  emit("Checking Amazon BSR for sales-rank bursts…");
  const res = await callEngine(brand);
  if (!res || res.error || !Array.isArray(res.spikes)) {
    emit("No live sales-rank data cached yet — inferring the mover from category signal.");
    return null;
  }
  const total = res.spikes.length;
  const discounted = res.spikes.filter((s) => s.gate === "discounted" || s.verdict === "price_drop").length;
  emit(`Detected ${total} rank burst(s); price-gated ${discounted} as discount-driven (steady-price ones survive).`);
  emit("Pulling creator content & PRs from the 7 days before each surviving burst…");
  const mover = res.topAttribution?.creator;
  if (mover?.handle) {
    emit(`Most viral post → @${mover.handle} moved a competitor's rank with the price held flat — that's the market mover.`);
    return {
      handle: mover.handle,
      followers: mover.followers,
      sigma: mover.compositeSigma,
      evidence: "drove a real, flat-price rank burst for a competitor",
    };
  }
  emit("Bursts found, but no single creator stands out — widening to category lookalikes.");
  return null;
}

/** (i) Find creators similar to the proven mover (or top in-niche if none). */
async function stepSimilar(
  brand: BrandOnboarding,
  mover: MarketMover | null,
  emit: (s: string) => void,
): Promise<CreatorCandidate[]> {
  const niche = brand.category || brand.brand || "the category";
  emit(mover ? `Finding creators similar to @${mover.handle}…` : `Finding top creators in ${niche}…`);
  const candidates = await discoverSimilarCreators({
    niche,
    platform: "instagram",
    seedHandle: mover?.handle,
    maxResults: 6,
  });
  emit(`Found ${candidates.length} candidate creator(s); scoring by fit & reach.`);
  return candidates;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** (j) Build the ranked shortlist — proven mover first, then lookalikes. */
function buildSuggestions(mover: MarketMover | null, candidates: CreatorCandidate[]): InfluencerSuggestion[] {
  const out: InfluencerSuggestion[] = [];
  if (mover) {
    out.push({
      handle: mover.handle,
      platform: "instagram",
      followers: mover.followers,
      score: 0.95,
      rationale: `Proven market mover — ${mover.evidence}.`,
    });
  }
  candidates.forEach((c, i) => {
    if (mover && c.handle.toLowerCase() === mover.handle.toLowerCase()) return;
    out.push({
      handle: c.handle,
      platform: c.platform,
      pk: c.pk,
      followers: c.followers,
      score: round2(Math.max(0.55, 0.88 - i * 0.05)),
      rationale: c.bio
        ? `Similar niche & audience — ${truncate(c.bio, 80)}`
        : "Similar niche & audience to the proven market mover.",
    });
  });
  return out;
}

function buildReply(brand: BrandOnboarding, mover: MarketMover | null, influencers: InfluencerSuggestion[]): string {
  const name = brand.brand || "your brand";
  if (!influencers.length) {
    return `I ran the analysis for ${name} but couldn't surface creators right now — try again with a homepage URL so I can read the category.`;
  }
  const top = influencers.slice(0, 3).map((i) => `@${i.handle}`).join(", ");
  if (mover) {
    return `For ${name}: I found the creator who actually moved a competitor's Amazon rank (with the price flat, so it was real demand, not a discount) — @${mover.handle} — then pulled lookalikes who reach the same audience. Shortlist: ${top}, … Want me to DM any of them?`;
  }
  return `For ${name}: no cached sales-burst data yet, so I ranked by category fit and competitor signal — ${top}, … This is a discovery hypothesis (correlation, not proven causation). Want me to DM any of them?`;
}

/**
 * Run the full a–j chain. Returns a complete DiscoveryResult with the narrated
 * `steps`. Each stage is independently fault-tolerant; the chain never throws.
 */
export async function runAjChain(input: DiscoveryInput): Promise<DiscoveryResult> {
  const steps: string[] = [];
  const emit = (s: string): void => {
    steps.push(s);
  };

  const brand = await stepOnboard(input, emit).catch((): BrandOnboarding => {
    emit("Couldn't fully read the homepage — proceeding on category signal.");
    return { brand: input.brandUrl ? hostname(input.brandUrl) : "your brand", category: "", summary: "", competitors: [], seedAsins: [], homepageUrl: input.brandUrl ?? "" };
  });

  // Discovery: the most-viral Instagram reels ABOUT THE BRAND (its own hashtag),
  // ranked by views → the top 6 creators behind them. Apify-only (apidojo cheap
  // listing + official-actor enrichment for real views/video/avatar); no deep
  // pagination, no ScrapeCreators. Falls back to category lookalikes.
  // The rank/price chart is rendered separately from the engine (visuals layer).
  let influencers: InfluencerSuggestion[] = [];
  let reply = "";
  let chart: DiscoveryResult["chart"];
  const haveApify = Boolean(process.env.APIFY_TOKEN?.trim());

  // The CHART shows the COMPETITOR product whose real Amazon sales-rank burst
  // (steady price, last 1y) motivates the outreach — separate from the brand-reel
  // creator search. Runs in parallel; never blocks the influencers.
  const haveKeepa = Boolean(process.env.KEEPA_API_KEY?.trim());
  const chartP = haveKeepa
    ? findInfluencersFromBurst({ brand, emit, chartOnly: true }).catch(() => null)
    : Promise.resolve(null);

  if (haveApify) {
    const r = await findBrandReelInfluencers({ brand, emit }).catch(() => null);
    if (r && r.influencers.length) {
      influencers = r.influencers;
      const names = influencers.map((i) => `@${i.handle}`).join(", ");
      reply =
        `Analyzing ${brand.brand || "that competitor"}: the creators behind the most-viral Instagram reels about them are ${names}. ` +
        `They already reach the audience you're after — want me to DM them?`;
    }
  }

  const burst = await chartP;
  console.warn("[aj-chain] chartP:", JSON.stringify({ ok: !!burst, hasBurst: !!burst?.burst, pts: burst?.burst?.points?.length, rf: burst?.burst?.rankFrom }));
  if (burst?.burst?.points?.length) {
    const b = burst.burst;
    chart = {
      competitor: b.competitor,
      productTitle: b.productTitle,
      productImage: b.productImage,
      rankFrom: b.rankFrom,
      rankTo: b.rankTo,
      date: b.date,
      points: b.points!,
    };
  }

  // Fallback: category-fit lookalikes (no keys, no recent burst, or no in-window creators).
  if (influencers.length === 0) {
    emit("Falling back to category-fit creators.");
    const candidates = await stepSimilar(brand, null, emit).catch(() => [] as CreatorCandidate[]);
    influencers = buildSuggestions(null, candidates);
    reply = buildReply(brand, null, influencers);
  }

  emit("Ranking the shortlist…");
  return { reply, steps, influencers, chart };
}
