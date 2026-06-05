/**
 * Primitive domain vocabulary shared across every layer.
 *
 * EXTENSIBILITY RULE: these unions are open by design. `Platform` and
 * `Marketplace` can grow; `ProviderId` is a free string keyed to the
 * `data_provider` registry table — adding a vendor is a row + an adapter,
 * never a code/schema change. See ARCHITECTURE.md.
 */

export type Platform = "tiktok" | "instagram";

export type Marketplace = "amazon";

/** Registry key for a data source, e.g. "keepa", "apify.apidojo", "modash". */
export type ProviderId = string;

/** What a provider can do. Code depends on capabilities, never on vendors. */
export type Capability =
  | "commerce.timeseries"
  | "commerce.product"
  | "social.profile"
  | "social.posts"
  | "social.mentions"
  | "creator.report"
  | "creator.search";

/** ISO-8601 timestamp string (e.g. "2026-06-03T10:25:00Z"). */
export type Timestamp = string;

/** ISO date string (e.g. "2026-06-03"). */
export type DateString = string;

/** Pointer to a marketplace product (e.g. an Amazon ASIN). */
export interface ProductRef {
  marketplace: Marketplace;
  externalId: string;
}

/** Pointer to a social account; resolve by id when known, else handle. */
export interface AccountRef {
  platform: Platform;
  platformAccountId?: string;
  handle?: string;
}
