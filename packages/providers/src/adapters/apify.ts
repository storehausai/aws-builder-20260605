import type {
  Capability,
  NormalizedMention,
  Platform,
  RawFetch,
} from "@pebble/core";

/**
 * Apify adapter (provider id "apify.apidojo") — capability "social.mentions".
 *
 * Searches a social platform for creator posts mentioning a brand and
 * normalizes them to the canonical NormalizedMention shape. Deliberately
 * simple and error-proof: one fetch helper, one input builder + one output
 * mapper per platform, every field guarded (dataset items are dirty).
 *
 * Mechanism: Apify's "run-sync-get-dataset-items" endpoint runs the actor and
 * returns the default dataset items array directly in the response body — no
 * polling. See https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-post
 */

/* ------------------------------ constants ------------------------------ */

const PROVIDER_ID = "apify.apidojo";

/**
 * Actor ids keyed by platform. The "~" is the owner~name separator Apify uses
 * in the API path (e.g. clockworks~tiktok-scraper).
 */
const ACTOR_BY_PLATFORM: Record<Platform, string> = {
  tiktok: "clockworks~tiktok-scraper",
  instagram: "apify~instagram-scraper",
};

const DEFAULT_LIMIT = 50;

/* -------------------------------- types -------------------------------- */

export interface SearchMentionsQuery {
  brand: string;
  platform: Platform;
  /** how many days back to look (best-effort; passed to actors that support it) */
  sinceDays?: number;
  /** max dataset items to fetch — bounds cost. Defaults to 50. */
  limit?: number;
}

export interface ApifyAdapter {
  readonly id: typeof PROVIDER_ID;
  readonly capabilities: readonly Capability[];
  searchMentions(query: SearchMentionsQuery): Promise<RawFetch>;
  normalizeMentions(raw: RawFetch): NormalizedMention[];
}

/* ------------------------------ helpers -------------------------------- */

/** Convert anything to a finite number, or null. Handles numeric strings. */
function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Non-empty trimmed string, or null. */
function toStringOrNull(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** "today minus N days" as a YYYY-MM-DD date string (for date-filter inputs). */
function sinceDateString(sinceDays: number): string {
  const ms = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Cap a limit to a sane bounded positive integer. */
function boundedLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.floor(limit);
}

/* ----------------------------- input builders -------------------------- */

/**
 * Build the actor input for a brand search. The "input" is the actor's own
 * JSON config — field names differ per actor, so each platform gets its own
 * builder. We search by the brand as a hashtag and bound results to `limit`.
 */
function buildActorInput(query: SearchMentionsQuery): Record<string, unknown> {
  const limit = boundedLimit(query.limit);
  // Strip a leading "#" if the caller already passed one; we add it back where needed.
  const brand = query.brand.trim().replace(/^#/, "");

  if (query.platform === "tiktok") {
    // clockworks/tiktok-scraper: `hashtags` collects videos for each tag;
    // `resultsPerPage` caps results per tag. `searchQueries` also covers the
    // brand as a keyword (Top section) for non-hashtag mentions.
    const input: Record<string, unknown> = {
      hashtags: [brand],
      searchQueries: [brand],
      resultsPerPage: limit,
    };
    if (typeof query.sinceDays === "number") {
      // Coarse built-in date window; the actor only offers preset buckets.
      input.videoSearchDateFilter =
        query.sinceDays <= 7
          ? "LAST_7_DAYS"
          : query.sinceDays <= 30
            ? "LAST_30_DAYS"
            : query.sinceDays <= 90
              ? "LAST_90_DAYS"
              : "LAST_6_MONTHS";
    }
    return input;
  }

  // instagram (apify/instagram-scraper): `search` + `searchType:"hashtag"`
  // finds the hashtag, `resultsType:"posts"` returns post items, and
  // `resultsLimit` caps posts. `onlyPostsNewerThan` accepts YYYY-MM-DD.
  const input: Record<string, unknown> = {
    search: brand,
    searchType: "hashtag",
    searchLimit: 1,
    resultsType: "posts",
    resultsLimit: limit,
    addParentData: false,
  };
  if (typeof query.sinceDays === "number") {
    input.onlyPostsNewerThan = sinceDateString(query.sinceDays);
  }
  return input;
}

/* -------------------------------- fetch -------------------------------- */

async function runActorSync(
  actorId: string,
  token: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  // run-sync-get-dataset-items returns the dataset items array directly.
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(
    token,
  )}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (cause) {
    // Network-level failure (DNS, connection reset, etc.).
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`apify: ${actorId} network error ${message}`);
  }

  if (!response.ok) {
    // Surface a short, informative error including a snippet of the body.
    let body = "";
    try {
      body = (await response.text()).slice(0, 300);
    } catch {
      body = "<unreadable body>";
    }
    throw new Error(`apify: ${actorId} ${response.status} ${body}`);
  }

  try {
    return await response.json();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`apify: ${actorId} invalid JSON ${message}`);
  }
}

/* ------------------------------ normalizers ---------------------------- */

/** Coerce a RawFetch.payload to an array of items (guarding dirty shapes). */
function itemsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  // Some responses wrap items as { items: [...] }; tolerate that.
  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { items?: unknown }).items)
  ) {
    return (payload as { items: unknown[] }).items;
  }
  return [];
}

/** Read a nested object property safely (e.g. authorMeta.name). */
function getNested(item: Record<string, unknown>, key: string): unknown {
  const nested = item[key];
  return nested && typeof nested === "object"
    ? (nested as Record<string, unknown>)
    : undefined;
}

function mapTikTokItem(raw: unknown): NormalizedMention | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;

  const authorMeta =
    (getNested(item, "authorMeta") as Record<string, unknown> | undefined) ?? {};

  const handle = toStringOrNull(authorMeta.name);
  const externalId = toStringOrNull(item.id);
  // Drop items missing the natural-key essentials.
  if (!handle || !externalId) return null;

  // postedAt: prefer ISO field, else convert unix seconds → ISO.
  let postedAt = toStringOrNull(item.createTimeISO);
  if (!postedAt) {
    const createTime = toNumberOrNull(item.createTime);
    if (createTime !== null) {
      postedAt = new Date(createTime * 1000).toISOString();
    }
  }

  return {
    platform: "tiktok",
    creatorHandle: handle,
    creatorAccountId: toStringOrNull(authorMeta.id),
    externalId,
    externalUrl: toStringOrNull(item.webVideoUrl),
    postedAt: postedAt ?? null,
    views: toNumberOrNull(item.playCount),
    likes: toNumberOrNull(item.diggCount),
    comments: toNumberOrNull(item.commentCount),
    creatorFollowers: toNumberOrNull(authorMeta.fans),
  };
}

function mapInstagramItem(raw: unknown): NormalizedMention | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;

  const handle = toStringOrNull(item.ownerUsername);
  // externalId: prefer `id`, fall back to `shortCode`.
  const externalId = toStringOrNull(item.id) ?? toStringOrNull(item.shortCode);
  if (!handle || !externalId) return null;

  return {
    platform: "instagram",
    creatorHandle: handle,
    creatorAccountId: toStringOrNull(item.ownerId),
    externalId,
    externalUrl: toStringOrNull(item.url),
    postedAt: toStringOrNull(item.timestamp),
    // Post items expose video views only (null for images); follower count is
    // not present on Instagram post items, so it's always null here.
    views: toNumberOrNull(item.videoViewCount),
    likes: toNumberOrNull(item.likesCount),
    comments: toNumberOrNull(item.commentsCount),
    creatorFollowers: null,
  };
}

/* ------------------------------- factory ------------------------------- */

/**
 * Create the Apify mentions adapter. `token` is the Apify API token used to
 * authenticate run-sync calls; it is not needed for normalization.
 */
export function createApifyAdapter(token: string): ApifyAdapter {
  return {
    id: PROVIDER_ID,
    capabilities: ["social.mentions"],

    async searchMentions(query: SearchMentionsQuery): Promise<RawFetch> {
      const actorId = ACTOR_BY_PLATFORM[query.platform];
      if (!actorId) {
        throw new Error(`apify: unsupported platform ${String(query.platform)}`);
      }
      if (!token || token.trim() === "") {
        throw new Error("apify: missing API token");
      }

      const input = buildActorInput(query);
      const payload = await runActorSync(actorId, token, input);

      return {
        providerId: PROVIDER_ID,
        capability: "social.mentions",
        payload,
        fetchedAt: new Date().toISOString(),
        endpoint: `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items`,
        actor: actorId,
      };
    },

    normalizeMentions(raw: RawFetch): NormalizedMention[] {
      const actor = raw.actor ?? "";
      const items = itemsFromPayload(raw.payload);

      // Dispatch by the actor id we stored on the RawFetch.
      let map: (item: unknown) => NormalizedMention | null;
      if (actor.includes("tiktok")) {
        map = mapTikTokItem;
      } else if (actor.includes("instagram")) {
        map = mapInstagramItem;
      } else {
        throw new Error(`apify: cannot normalize, unknown actor "${actor}"`);
      }

      const out: NormalizedMention[] = [];
      for (const item of items) {
        const mention = map(item);
        if (mention) out.push(mention); // dirty items (no handle/id) are dropped
      }
      return out;
    },
  };
}
