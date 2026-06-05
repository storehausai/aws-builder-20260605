import type {
  IngestionWriter,
  NormalizedCommerce,
  NormalizedMention,
  ProviderId,
  RawFetch,
} from "@pebble/core";
import type { Bb } from "./client.js";
import { unwrap } from "./client.js";
import { upsertRows, upsertReturning, insertReturning } from "./upsert.js";

/**
 * Real IngestionWriter on Butterbase — the idempotent cache (Track A seam).
 * Every write is an upsert on a natural key (emulated via @pebble/bb upsert),
 * so re-running a tool MERGES instead of duplicating — we never re-pay an API
 * for data we already hold.
 */
export function createIngestionWriter(bb: Bb): IngestionWriter {
  async function ensureProvider(providerId: ProviderId, kind: string): Promise<void> {
    await upsertRows(bb, "data_provider", [{ id: providerId, name: providerId, kind }], ["id"]);
  }

  async function resolveBrand(slug: string, name: string): Promise<string> {
    const row = await upsertReturning<{ id: string }>(bb, "brand", { slug, name }, ["slug"], "id");
    return row.id;
  }

  return {
    async writeRaw(raw: RawFetch): Promise<string> {
      const isSocial = raw.capability.startsWith("social.") || raw.capability.startsWith("creator.");
      await ensureProvider(raw.providerId, isSocial ? "social" : "commerce");
      const table = isSocial ? "social_fetch_raw" : "commerce_fetch_raw";
      const row = await insertReturning<{ id: string }>(
        bb,
        table,
        {
          provider_id: raw.providerId,
          capability: raw.capability,
          endpoint: raw.endpoint ?? null,
          payload: raw.payload,
          fetched_at: raw.fetchedAt,
        },
        "id",
      );
      return row.id;
    },

    async upsertCommerce(
      normalized: NormalizedCommerce,
      providerId: ProviderId,
      brand: { slug: string; name: string },
    ): Promise<{ brandId: string }> {
      await ensureProvider(providerId, "commerce");
      const brandId = await resolveBrand(brand.slug, brand.name);

      const productRows = normalized.products.map((p) => ({
        marketplace: p.marketplace,
        external_id: p.externalId,
        brand_id: brandId,
        title: p.title,
        image_url: p.imageUrl,
        category: p.category,
      }));
      await upsertRows(bb, "commerce_product", productRows, ["marketplace", "external_id"]);

      const prods = unwrap(
        await bb.from("commerce_product").select("id, external_id").eq("brand_id", brandId),
      ) as Array<{ id: string; external_id: string }>;
      const idByAsin = new Map(prods.map((p) => [p.external_id, p.id]));

      const snapRows = normalized.points
        .map((pt) => {
          const productId = idByAsin.get(pt.externalId);
          if (!productId) return null;
          return {
            product_id: productId,
            snapshot_date: pt.snapshotDate,
            rank: pt.rank,
            price: pt.price,
            rating: pt.rating,
            review_count: pt.reviewCount,
            provider_id: providerId,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      await upsertRows(bb, "commerce_product_snapshot", snapRows, ["product_id", "snapshot_date"]);

      return { brandId };
    },

    async upsertMentions(
      brandSlug: string,
      mentions: NormalizedMention[],
      providerId: ProviderId,
    ): Promise<{ count: number }> {
      await ensureProvider(providerId, "social");
      const brandId = await resolveBrand(brandSlug, brandSlug);

      // creator_account_id is a uuid FK to social_account — only accept a real
      // uuid; a vendor's numeric id must never land here or the batch is rejected.
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const rows = mentions.map((m) => ({
        brand_id: brandId,
        platform: m.platform,
        creator_handle: m.creatorHandle,
        creator_account_id: m.creatorAccountId && UUID_RE.test(m.creatorAccountId) ? m.creatorAccountId : null,
        external_id: m.externalId,
        external_url: m.externalUrl ?? null,
        posted_at: m.postedAt ?? null,
        views: m.views ?? null,
        likes: m.likes ?? null,
        comments: m.comments ?? null,
        creator_followers: m.creatorFollowers ?? null,
        cover_url: m.coverUrl ?? null,
        caption: m.caption ?? null,
        provider_id: providerId,
        status: "detected",
      }));
      await upsertRows(bb, "brand_mention", rows, ["brand_id", "platform", "external_id"]);
      return { count: rows.length };
    },
  };
}
