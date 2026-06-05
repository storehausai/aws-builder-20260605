/**
 * @pebble/providers — the extensible "API player" (ports & adapters).
 *
 * The registry resolves a CAPABILITY → a provider; callers never name a vendor.
 * Add a vendor by writing an adapter in ./adapters and registering it — no
 * schema/engine/app changes. `.js` suffixes on relative imports are required for
 * ESM (NodeNext) resolution.
 */

import { ProviderRegistry } from "./registry.js";
import { stubCommerceProvider } from "./adapters/stub.js";
import { createKeepaAdapter } from "./adapters/keepa.js";
import { createApifyAdapter } from "./adapters/apify.js";
import { createScrapeCreatorsAdapter } from "./adapters/scrapecreators.js";

export * from "./registry.js";
export * from "./adapters/stub.js";
export { createKeepaAdapter, keepaAdapter } from "./adapters/keepa.js";
export type { KeepaAdapter } from "./adapters/keepa.js";
export { createApifyAdapter } from "./adapters/apify.js";
export type { ApifyAdapter, SearchMentionsQuery } from "./adapters/apify.js";
export {
  createScrapeCreatorsAdapter,
  SCRAPECREATORS_INSTAGRAM_ACTOR,
} from "./adapters/scrapecreators.js";
export type { ScrapeCreatorsAdapter } from "./adapters/scrapecreators.js";
export { resolveInstagramProfile } from "./adapters/instagram-public.js";
export type { InstagramProfile } from "./adapters/instagram-public.js";
export { onboardFromUrl } from "./adapters/storefront-onboarding.js";
export type { BrandOnboarding } from "./adapters/storefront-onboarding.js";
export { discoverSimilarCreators } from "./adapters/creator-discovery.js";
export type {
  CreatorCandidate,
  SimilarCreatorQuery,
} from "./adapters/creator-discovery.js";

/**
 * Build a ready-to-use registry: always registers the stub commerce adapter,
 * plus any keyed adapter whose API-key env var is present. Callers get a
 * registry that resolves real providers when secrets are configured and
 * degrades gracefully (only the stub) when they are not.
 *
 * Env vars consulted:
 *   - KEEPA_API_KEY          → keepa (commerce.timeseries)
 *   - APIFY_TOKEN            → apify.apidojo (social.mentions)
 *   - SCRAPECREATORS_API_KEY → scrapecreators (social.mentions)
 */
export function buildDefaultRegistry(
  env: Record<string, string | undefined> = process.env,
): ProviderRegistry {
  const registry = new ProviderRegistry();

  // Always available — proves the port shape compiles end to end.
  registry.register(stubCommerceProvider);

  const keepaKey = env.KEEPA_API_KEY?.trim();
  if (keepaKey) {
    registry.register(createKeepaAdapter(keepaKey));
  }

  const apifyToken = env.APIFY_TOKEN?.trim();
  if (apifyToken) {
    registry.register(createApifyAdapter(apifyToken));
  }

  const scrapeKey = env.SCRAPECREATORS_API_KEY?.trim();
  if (scrapeKey) {
    registry.register(createScrapeCreatorsAdapter(scrapeKey));
  }

  return registry;
}
