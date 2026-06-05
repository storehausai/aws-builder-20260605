import type {
  Capability,
  NormalizedMention,
  Platform,
  RawFetch,
} from "@pebble/core";

/**
 * ScrapeCreators adapter (provider id "scrapecreators") — capability
 * "social.mentions". A drop-in alternative to the Apify adapter for fetching
 * brand-mention posts.
 *
 * Design goals: SIMPLE and ERROR-PROOF. The TikTok keyword search is paged
 * chronologically (sort_by=date-posted) so we can EARLY-STOP once a page's
 * oldest post predates the requested window — cheap, date-window-bounded
 * fetching. Each post's timestamp is derived from its 19-digit aweme_id via the
 * verified decode `unix_seconds = Number(BigInt(aweme_id) >> 32n)`.
 *
 * Only TikTok is fully verified. Instagram is a clearly-marked best-effort stub
 * (its response shape was not confirmed) — it throws a descriptive error.
 *
 * Docs: https://docs.scrapecreators.com  ·  Base: https://api.scrapecreators.com
 */

/* ------------------------------ constants ------------------------------ */

const PROVIDER_ID = "scrapecreators";
const BASE_URL = "https://api.scrapecreators.com";

const ACTOR_TIKTOK = "tiktok/keyword";
const ACTOR_INSTAGRAM = "instagram/hashtag";

/** Safety bound on pages fetched when the window-based early-stop never fires. */
const DEFAULT_MAX_PAGES = 5;

/* -------------------------------- types -------------------------------- */

export interface SearchMentionsQuery {
  brand: string;
  platform: Platform;
  /** inclusive lower bound, ISO date/datetime string (enables early-stop). */
  fromDate?: string;
  /** inclusive upper bound, ISO date/datetime string. */
  toDate?: string;
  /** hard cap on pages fetched (cost bound). Defaults to 5. */
  maxPages?: number;
}

/**
 * The brand + window recorded alongside the raw items so normalization can
 * re-apply the brand and date-window filters without the original query.
 */
interface RecordedQuery {
  brand: string;
  fromDate: string | null;
  toDate: string | null;
}

interface ScrapeCreatorsPayload {
  query: RecordedQuery;
  items: unknown[];
}

export interface ScrapeCreatorsAdapter {
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

/** Read a nested object property safely. */
function getObject(
  item: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const nested = item[key];
  return nested && typeof nested === "object"
    ? (nested as Record<string, unknown>)
    : {};
}

/**
 * Decode a TikTok aweme_id to unix MILLISECONDS via the verified bit-shift
 * `unix_seconds = Number(BigInt(aweme_id) >> 32n)`. The id is a 19-digit string,
 * so BigInt is mandatory. Returns null if the id is not a positive integer
 * string (guards dirty data — never throws).
 */
function decodeAwemeIdMs(awemeId: unknown): number | null {
  const id = toStringOrNull(awemeId);
  if (id === null || !/^\d+$/.test(id)) return null;
  try {
    const seconds = Number(BigInt(id) >> 32n);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return seconds * 1000;
  } catch {
    return null;
  }
}

/** Parse an ISO date/datetime to epoch ms, or null. */
function parseBoundMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Cap maxPages to a sane bounded positive integer. */
function boundedMaxPages(maxPages: number | undefined): number {
  if (
    typeof maxPages !== "number" ||
    !Number.isFinite(maxPages) ||
    maxPages <= 0
  ) {
    return DEFAULT_MAX_PAGES;
  }
  return Math.floor(maxPages);
}

/* -------------------------------- fetch -------------------------------- */

/** Verified TikTok keyword-search response envelope. */
interface KeywordResponse {
  success?: boolean;
  credits_remaining?: number;
  cursor?: number;
  search_item_list?: unknown[];
}

/** GET a TikTok keyword-search page. ERROR-PROOF: surfaces status + body. */
async function fetchKeywordPage(
  apiKey: string,
  brand: string,
  cursor: number,
): Promise<KeywordResponse> {
  const params = new URLSearchParams({
    query: brand,
    sort_by: "date-posted",
    date_posted: "all-time",
    trim: "true",
    cursor: String(cursor),
  });
  const url = `${BASE_URL}/v1/tiktok/search/keyword?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, { headers: { "x-api-key": apiKey } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`scrapecreators: network error ${message}`);
  }

  if (!response.ok) {
    let body = "";
    try {
      body = (await response.text()).slice(0, 200);
    } catch {
      body = "<unreadable body>";
    }
    throw new Error(`scrapecreators: ${response.status} ${body}`);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`scrapecreators: invalid JSON ${message}`);
  }

  if (!json || typeof json !== "object") {
    throw new Error("scrapecreators: response was not an object");
  }
  const data = json as KeywordResponse;
  if (data.success === false) {
    throw new Error("scrapecreators: success=false");
  }
  return data;
}

/**
 * Page the TikTok keyword search chronologically, collecting items until the
 * window's lower bound is crossed (early-stop) or maxPages is hit.
 */
async function collectTikTokItems(
  apiKey: string,
  brand: string,
  fromMs: number | null,
  maxPages: number,
): Promise<unknown[]> {
  const collected: unknown[] = [];
  let cursor = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const data = await fetchKeywordPage(apiKey, brand, cursor);
    const list = Array.isArray(data.search_item_list)
      ? data.search_item_list
      : [];
    if (list.length === 0) break;

    collected.push(...list);

    // EARLY-STOP: results are date-posted descending, so the oldest item is the
    // page's minimum decoded timestamp. Once that predates fromDate, all
    // subsequent pages are older too — stop.
    if (fromMs !== null) {
      let oldestMs: number | null = null;
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const ms = decodeAwemeIdMs((item as Record<string, unknown>).aweme_id);
        if (ms === null) continue;
        if (oldestMs === null || ms < oldestMs) oldestMs = ms;
      }
      if (oldestMs !== null && oldestMs < fromMs) break;
    }

    // Advance the cursor; stop if the API didn't give us a usable next cursor.
    const next = toNumberOrNull(data.cursor);
    if (next === null || next === cursor) break;
    cursor = next;
  }

  return collected;
}

/* ------------------------------ normalizers ---------------------------- */

/** Coerce a RawFetch.payload to the recorded { query, items } shape. */
function readPayload(payload: unknown): ScrapeCreatorsPayload {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const items = Array.isArray(p.items) ? p.items : [];
    const q = getObject(p, "query");
    return {
      query: {
        brand: toStringOrNull(q.brand) ?? "",
        fromDate: toStringOrNull(q.fromDate),
        toDate: toStringOrNull(q.toDate),
      },
      items,
    };
  }
  return { query: { brand: "", fromDate: null, toDate: null }, items: [] };
}

/** Map one verified TikTok keyword-search item → NormalizedMention or null. */
function mapTikTokItem(raw: unknown): NormalizedMention | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;

  const author = getObject(item, "author");
  const stats = getObject(item, "statistics");
  const video = getObject(item, "video");

  // creatorHandle ← author.unique_id, fallback author.nickname.
  const handle =
    toStringOrNull(author.unique_id) ?? toStringOrNull(author.nickname);
  const externalId = toStringOrNull(item.aweme_id);
  if (!handle || !externalId) return null;

  // postedAt: prefer create_time_utc, else decode create_time (unix sec) → ISO.
  let postedAt = toStringOrNull(item.create_time_utc);
  if (!postedAt) {
    const createTime = toNumberOrNull(item.create_time);
    if (createTime !== null) {
      postedAt = new Date(createTime * 1000).toISOString();
    }
  }

  return {
    platform: "tiktok",
    creatorHandle: handle,
    creatorAccountId: toStringOrNull(author.uid) ?? null,
    externalId,
    externalUrl: toStringOrNull(item.url),
    postedAt: postedAt ?? null,
    views: toNumberOrNull(stats.play_count),
    likes: toNumberOrNull(stats.digg_count),
    comments: toNumberOrNull(stats.comment_count),
    // Follower count is not present on a keyword-search post item.
    creatorFollowers: null,
    // caption ← item.desc (the same field the brand filter reads).
    caption: toStringOrNull(item.desc),
    // coverUrl ← video.cover (static thumbnail), fallback video.origin_cover.
    coverUrl: toStringOrNull(video.cover) ?? toStringOrNull(video.origin_cover),
  };
}

/* ------------------------------- factory ------------------------------- */

/**
 * Create the ScrapeCreators mentions adapter. `apiKey` authenticates fetches
 * (sent as the `x-api-key` header); it is not needed for normalization.
 */
export function createScrapeCreatorsAdapter(
  apiKey: string,
): ScrapeCreatorsAdapter {
  return {
    id: PROVIDER_ID,
    capabilities: ["social.mentions"],

    async searchMentions(query: SearchMentionsQuery): Promise<RawFetch> {
      const brand = query.brand?.trim() ?? "";
      if (brand === "") {
        throw new Error("scrapecreators: missing brand");
      }
      if (!apiKey || apiKey.trim() === "") {
        throw new Error("scrapecreators: missing API key");
      }

      const recorded: RecordedQuery = {
        brand,
        fromDate: toStringOrNull(query.fromDate),
        toDate: toStringOrNull(query.toDate),
      };

      if (query.platform === "instagram") {
        // Best-effort stub: the Instagram hashtag response shape could not be
        // verified live (only TikTok was). Do not silently return garbage.
        throw new Error(
          "scrapecreators: instagram (instagram/hashtag) is not yet verified — " +
            "confirm the /v1/instagram/search/hashtag response shape (param `hashtag`, " +
            "fields id/shortcode/caption/like_count/comment_count/taken_at/owner.username) " +
            "against https://docs.scrapecreators.com before enabling. verify IG shape.",
        );
      }

      if (query.platform !== "tiktok") {
        throw new Error(
          `scrapecreators: unsupported platform ${String(query.platform)}`,
        );
      }

      const fromMs = parseBoundMs(recorded.fromDate);
      const maxPages = boundedMaxPages(query.maxPages);
      const items = await collectTikTokItems(apiKey, brand, fromMs, maxPages);

      const payload: ScrapeCreatorsPayload = { query: recorded, items };

      return {
        providerId: PROVIDER_ID,
        capability: "social.mentions",
        payload,
        fetchedAt: new Date().toISOString(),
        endpoint: `${BASE_URL}/v1/tiktok/search/keyword`,
        actor: ACTOR_TIKTOK,
      };
    },

    normalizeMentions(raw: RawFetch): NormalizedMention[] {
      const actor = raw.actor ?? "";
      const { query, items } = readPayload(raw.payload);

      if (actor.includes("instagram")) {
        // No verified IG mapper — refuse rather than emit unreliable rows.
        throw new Error(
          `scrapecreators: cannot normalize instagram (actor "${actor}") — verify IG shape`,
        );
      }
      if (!actor.includes("tiktok")) {
        throw new Error(
          `scrapecreators: cannot normalize, unknown actor "${actor}"`,
        );
      }

      const brandLower = query.brand.trim().toLowerCase();
      const fromMs = parseBoundMs(query.fromDate);
      const toMs = parseBoundMs(query.toDate);

      const out: NormalizedMention[] = [];
      for (const rawItem of items) {
        const mention = mapTikTokItem(rawItem);
        if (!mention) continue; // missing handle/aweme_id

        // BRAND FILTER: keyword search is fuzzy — drop posts whose desc does not
        // contain the brand (case-insensitive). Sampled results often miss it.
        if (brandLower !== "") {
          const desc =
            rawItem && typeof rawItem === "object"
              ? toStringOrNull((rawItem as Record<string, unknown>).desc)
              : null;
          if (!desc || !desc.toLowerCase().includes(brandLower)) continue;
        }

        // DATE-WINDOW FILTER: use the aweme_id decode (authoritative), drop
        // anything outside [fromDate, toDate].
        if (fromMs !== null || toMs !== null) {
          const ms = decodeAwemeIdMs(mention.externalId);
          if (ms === null) continue;
          if (fromMs !== null && ms < fromMs) continue;
          if (toMs !== null && ms > toMs) continue;
        }

        out.push(mention);
      }
      return out;
    },
  };
}

/** Exposed only so the IG path is discoverable; mirrors ACTOR_INSTAGRAM. */
export const SCRAPECREATORS_INSTAGRAM_ACTOR = ACTOR_INSTAGRAM;
