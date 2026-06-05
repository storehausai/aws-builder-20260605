/**
 * IngestionWriter — the SEAM between @pebble/providers (normalize) and @pebble/db
 * (persist). It encapsulates resolve-or-create + upsert-on-natural-key, which is
 * what makes ingestion IDEMPOTENT — the cache/dedup that means we never re-pay
 * for data we already have.
 *
 * A tool produces Normalized* via a provider adapter, then calls the writer to
 * persist it. The interface lives here so both sides agree; the implementation
 * lives in @pebble/db (it owns the Supabase client + the natural-key upserts).
 */

import type { NormalizedCommerce, NormalizedMention } from "./ports";
import type { ProviderId } from "./primitives";
import type { RawFetch } from "./raw";

export interface IngestionWriter {
  /** Append an L0 raw fetch (routed by capability) to *_fetch_raw; returns its id. */
  writeRaw(raw: RawFetch): Promise<string>;
  /**
   * Upsert products + daily snapshots on natural keys
   * (marketplace+external_id, product+snapshot_date). Returns the brandId the
   * products were attached to.
   */
  upsertCommerce(
    normalized: NormalizedCommerce,
    providerId: ProviderId,
    brand: { slug: string; name: string },
  ): Promise<{ brandId: string }>;
  /** Upsert brand mentions on (brand_id, platform, external_id). */
  upsertMentions(
    brandSlug: string,
    mentions: NormalizedMention[],
    providerId: ProviderId,
  ): Promise<{ count: number }>;
}
