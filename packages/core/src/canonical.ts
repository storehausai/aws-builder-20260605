/**
 * Canonical domain entities — the vendor-agnostic shapes that live in the
 * data layer. DB rows are snake_case (see @pebble/db); these are the camelCase
 * domain types the engine and agent reason over.
 *
 * ZONES (see ARCHITECTURE.md):
 *   GLOBAL  — one row per real-world thing, shared across all customers. The
 *             moat: social_*, commerce_*, brand, brand_*, detected_event,
 *             attribution. All carry provider provenance on observations.
 *   SCOPED  — per customer (RLS): stores, tracked_brand, requests, panels.
 *
 * Every snapshot/observation carries a `providerId` so two vendors feeding the
 * same entity MERGE on a natural key, never duplicate.
 */

import type {
  DateString,
  Marketplace,
  Platform,
  ProviderId,
  Timestamp,
} from "./primitives";

/* ----------------------------- social (GLOBAL) ----------------------------- */

export interface SocialAccount {
  id: string;
  platform: Platform;
  platformAccountId: string; // immutable natural key with platform
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  verified: boolean | null;
  followersCount: number | null; // denormalized latest (truth lives in snapshots)
  postsCount: number | null;
  lastFetchedAt: Timestamp | null;
}

export interface SocialPost {
  id: string;
  accountId: string;
  externalId: string; // natural key with accountId
  url: string | null;
  postedAt: Timestamp | null;
  caption: string | null;
  coverUrl: string | null;
  hashtags: string[];
  mentions: string[];
}

/** Append-only daily account metrics. Natural key: (accountId, snapshotDate). */
export interface SocialAccountSnapshot {
  accountId: string;
  snapshotDate: DateString;
  followerCount: number | null;
  postCount: number | null;
  providerId: ProviderId;
}

/** Append-only daily post metrics. Natural key: (postId, snapshotDate). */
export interface SocialPostSnapshot {
  postId: string;
  snapshotDate: DateString;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  providerId: ProviderId;
}

/* ---------------------------- commerce (GLOBAL) ---------------------------- */

export interface CommerceProduct {
  id: string;
  marketplace: Marketplace;
  externalId: string; // ASIN; natural key with marketplace
  brandId: string | null; // FK to Brand — products belong to a brand
  title: string | null;
  imageUrl: string | null;
  category: string | null;
}

/** Append-only daily product metrics. Natural key: (productId, snapshotDate). */
export interface CommerceProductSnapshot {
  productId: string;
  snapshotDate: DateString;
  rank: number | null; // BSR — the sales proxy
  price: number | null;
  rating: number | null;
  reviewCount: number | null;
  providerId: ProviderId;
}

/* ----------------------- brand graph (GLOBAL — moat) ----------------------- */

/** A real-world commerce brand (the store's own + competitors). */
export interface Brand {
  id: string;
  name: string;
  slug: string; // canonical natural key
  domain: string | null;
}

/** A brand's official social accounts. */
export interface BrandAccount {
  brandId: string;
  accountId: string;
  role: string; // 'official' | ...
}

/** A creator post mentioning a brand (tagged/hashtag). Global, brand-keyed. */
export interface BrandMention {
  id: string;
  brandId: string;
  platform: Platform;
  creatorHandle: string;
  creatorAccountId: string | null; // FK SocialAccount when resolved
  postId: string | null; // FK SocialPost when resolved
  externalUrl: string | null;
  postedAt: Timestamp | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  creatorFollowers: number | null;
  providerId: ProviderId;
  status: string; // 'detected' | 'verified' | ... (global curation)
}

/* --------------------- outcome graph (GLOBAL — the moat) -------------------- */

/** A detected sales movement on a product (engine output, product-keyed). */
export interface DetectedEvent {
  id: string;
  productId: string;
  eventDate: DateString;
  kind: string; // 'sales_spike'
  rankFrom: number | null;
  rankTo: number | null;
  magnitude: number | null;
  method: string; // which detector produced it (e.g. 'hampel_v1')
}

/** Links a detected event to creator activity, with confidence. Global. */
export interface Attribution {
  id: string;
  eventId: string;
  brandId: string | null;
  accountId: string | null;
  postId: string | null;
  mentionId: string | null;
  confidence: number; // 0..1
  method: string; // swappable; weak heuristic v1 → causal later
  evidence: Record<string, unknown>;
}

/* --------------------------- tenancy (SCOPED) --------------------------- */

export interface Store {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
}

/** Thin per-store pointer: store S watches brand B. */
export interface TrackedBrand {
  id: string;
  storeId: string;
  brandId: string;
  isSelf: boolean; // true = the store's own brand
}
