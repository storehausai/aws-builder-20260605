/**
 * Provider capability PORTS (the "ports" in ports-and-adapters).
 *
 * The whole system depends on these interfaces, never on a vendor. A vendor
 * is an adapter that implements one or more ports (in @pebble/providers). Each
 * adapter does exactly two things: (1) fetch → RawFetch (L0), and
 * (2) normalize(raw) → canonical upsert payloads (L1). Nothing else in the
 * system ever sees vendor-native JSON.
 */

import type {
  AccountRef,
  Capability,
  DateString,
  Marketplace,
  Platform,
  ProductRef,
  ProviderId,
  Timestamp,
} from "./primitives";
import type { CommerceProduct, SocialAccount, SocialPost } from "./canonical";
import type { RawFetch } from "./raw";

/* ------------------------------- queries ------------------------------- */

export interface MentionQuery {
  brand: string;
  platform: Platform;
  /** hashtags / handles to search for tagged posts */
  terms?: string[];
  since?: DateString;
}

export interface CreatorSearchQuery {
  platform: Platform;
  minFollowers?: number;
  maxFollowers?: number;
  keywords?: string[];
  geo?: string;
}

/* --------------------- normalized upsert payloads ---------------------- */

export interface NormalizedProductPoint {
  marketplace: Marketplace;
  externalId: string;
  snapshotDate: DateString;
  rank: number | null;
  price: number | null;
  rating: number | null;
  reviewCount: number | null;
}

export interface NormalizedCommerce {
  products: Array<Omit<CommerceProduct, "id">>;
  points: NormalizedProductPoint[];
}

export interface NormalizedSocial {
  accounts: Array<Omit<SocialAccount, "id" | "lastFetchedAt">>;
  posts: Array<Omit<SocialPost, "id" | "accountId"> & { account: AccountRef }>;
}

/**
 * A creator post mentioning a brand, with engagement metrics inline — the shape
 * the market-mover scorer actually consumes (brand_mention row). Lighter than
 * the full accounts+posts+snapshots model; natural key (brand, platform,
 * externalId) makes re-ingestion idempotent.
 */
export interface NormalizedMention {
  platform: Platform;
  creatorHandle: string;
  creatorAccountId?: string | null;
  /** the post's vendor id — natural key with (brand, platform). */
  externalId: string;
  externalUrl?: string | null;
  postedAt?: Timestamp | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  creatorFollowers?: number | null;
  /** the post's text/description, for a content thumbnail caption. */
  caption?: string | null;
  /** a thumbnail image URL for the post (TikTok video cover). */
  coverUrl?: string | null;
}

export interface NormalizedCreatorReport {
  account: Omit<SocialAccount, "id" | "lastFetchedAt">;
  audience?: Record<string, unknown>;
  authenticity?: { fakeFollowerPct?: number; credibility?: number };
}

/* -------------------------------- ports -------------------------------- */

/** Base contract every adapter satisfies. */
export interface DataProvider {
  readonly id: ProviderId;
  readonly capabilities: readonly Capability[];
}

/** Amazon-style sales/rank/price signal over time (e.g. Keepa, Rainforest). */
export interface CommerceSignalProvider extends DataProvider {
  getProductHistory(ref: ProductRef): Promise<RawFetch>;
  normalizeProductHistory(raw: RawFetch): NormalizedCommerce;
}

/** Social content: profiles, posts, brand mentions (e.g. Apify, EnsembleData). */
export interface SocialContentProvider extends DataProvider {
  getProfile(ref: AccountRef): Promise<RawFetch>;
  getRecentPosts(ref: AccountRef): Promise<RawFetch>;
  searchMentions(query: MentionQuery): Promise<RawFetch>;
  normalize(raw: RawFetch): NormalizedSocial;
}

/** Creator analytics: audience + authenticity (e.g. Modash, HypeAuditor). */
export interface CreatorAnalyticsProvider extends DataProvider {
  getCreatorReport(ref: AccountRef): Promise<RawFetch>;
  searchCreators(query: CreatorSearchQuery): Promise<RawFetch>;
  normalizeReport(raw: RawFetch): NormalizedCreatorReport;
}
