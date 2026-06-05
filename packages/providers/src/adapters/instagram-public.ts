/**
 * Instagram public profile resolver — UNAUTHENTICATED.
 *
 * Used by the discovery step to turn an Instagram @handle into its stable
 * numeric user id (pk) plus a few profile facts (followers, name, bio,
 * verified). This is the one piece that lets the rest of the pipeline key an
 * account by its immutable id instead of a renameable handle.
 *
 * MECHANISM (empirically verified to return HTTP 200 with no auth):
 *   GET https://www.instagram.com/api/v1/users/web_profile_info/?username=<handle>
 *   header: x-ig-app-id: 936619743392459   (Instagram's public web app id)
 *
 * The body shape is:
 *   { data: { user: { id, full_name, biography, is_verified,
 *                     edge_followed_by: { count }, profile_pic_url, ... } } }
 *
 * Design rule for this file: SIMPLE and ERROR-PROOF. Every field is guarded
 * (the endpoint is undocumented and can drift), unknown handles resolve to
 * `null` (not an error), and transient rate-limit / network failures are
 * retried a bounded number of times with backoff before giving up.
 */

/* ------------------------------ constants ------------------------------ */

/** Instagram's public web App ID. Required or the endpoint 4xx's. */
const IG_APP_ID = "936619743392459";

const ENDPOINT =
  "https://www.instagram.com/api/v1/users/web_profile_info/";

/** A real browser UA — IG is pickier when the UA looks like a bot/null. */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Total attempts (1 initial + N-1 retries) on transient failures. */
const MAX_ATTEMPTS = 3;
/** Base backoff between retries, in ms (grows linearly per attempt). */
const RETRY_BASE_MS = 600;

/* ------------------------------- types --------------------------------- */

export interface InstagramProfile {
  /** the handle exactly as requested (normalized: no leading @, lowercased). */
  handle: string;
  /** stable numeric user id ("pk"), as a string to avoid precision loss. */
  pk: string;
  /** follower count (edge_followed_by.count); 0 if absent. */
  followers: number;
  fullName?: string;
  biography?: string;
  /** profile picture URL (HD if available, else standard). */
  profilePicUrl?: string;
  isVerified?: boolean;
}

/* ------------------------- vendor-native shapes ------------------------ */
/** Only the fields we read; IG returns much more. */

interface IgUser {
  id?: string | number;
  full_name?: string | null;
  biography?: string | null;
  is_verified?: boolean;
  edge_followed_by?: { count?: number } | null;
  profile_pic_url?: string | null;
  profile_pic_url_hd?: string | null;
}

interface IgResponse {
  data?: { user?: IgUser | null } | null;
  status?: string;
}

/* ------------------------------ helpers -------------------------------- */

/** Normalize a handle: strip a leading "@", trim, lowercase. */
function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, "").toLowerCase();
}

/** Non-empty trimmed string, or undefined (omitted from the result object). */
function toStringOrUndefined(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  return undefined;
}

/** Coerce a follower count to a finite non-negative integer (0 fallback). */
function toFollowerCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const n = Number(value.trim());
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return 0;
}

/** A user id can come back as a number or string; we always store a string. */
function toPk(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Sleep helper for backoff (no foreground-blocking spin). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------- fetch --------------------------------- */

/**
 * One HTTP attempt. Returns a discriminated result so the retry loop can decide
 * whether to retry (transient), give up with null (not-found), or throw (hard).
 */
type FetchResult =
  | { kind: "ok"; user: IgUser }
  | { kind: "not_found" }
  | { kind: "retry"; reason: string }
  | { kind: "fatal"; reason: string };

async function fetchOnce(handle: string): Promise<FetchResult> {
  const url = `${ENDPOINT}?username=${encodeURIComponent(handle)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "x-ig-app-id": IG_APP_ID,
        "user-agent": USER_AGENT,
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9",
        // IG enforces a "SecFetch Policy": the request must look like a same-origin
        // XHR fired from the profile page, or it 400s. These headers satisfy it.
        referer: `https://www.instagram.com/${encodeURIComponent(handle)}/`,
        "x-requested-with": "XMLHttpRequest",
        "x-ig-www-claim": "0",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
      },
    });
  } catch (cause) {
    // Network-level failure (DNS, reset, timeout) — worth retrying.
    const message = cause instanceof Error ? cause.message : String(cause);
    return { kind: "retry", reason: `network error: ${message}` };
  }

  // 404 → the username doesn't exist. Definitive "no profile", not an error.
  if (response.status === 404) {
    return { kind: "not_found" };
  }
  // 429 (rate limit) and 5xx are transient — retry with backoff.
  if (response.status === 429 || response.status >= 500) {
    return { kind: "retry", reason: `HTTP ${response.status}` };
  }
  // Any other non-2xx (401/403/400…) is a hard configuration/blocking error.
  if (!response.ok) {
    let snippet = "";
    try {
      snippet = (await response.text()).slice(0, 200);
    } catch {
      snippet = "<unreadable body>";
    }
    return { kind: "fatal", reason: `HTTP ${response.status} ${snippet}` };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (cause) {
    // 200 with a non-JSON body usually means IG served an HTML challenge /
    // login wall instead of the API payload — treat as transient and retry.
    const message = cause instanceof Error ? cause.message : String(cause);
    return { kind: "retry", reason: `invalid JSON: ${message}` };
  }

  const body = (json ?? {}) as IgResponse;
  const user = body.data?.user;
  if (!user || typeof user !== "object") {
    // Well-formed JSON but no user object — IG returns this for some missing /
    // restricted profiles. Treat as not-found rather than an error.
    return { kind: "not_found" };
  }
  return { kind: "ok", user };
}

/* ------------------------------- public -------------------------------- */

/**
 * Resolve a public Instagram profile by handle.
 *
 * @param handle the Instagram username (with or without a leading "@").
 * @returns the resolved profile, or `null` if the username does not exist /
 *          cannot be resolved without authentication.
 * @throws only on a hard, non-transient error (e.g. IG returns 403 blocking the
 *         unauthenticated endpoint, or a malformed/missing user id on a 200).
 *         Unknown handles and rate limits do NOT throw.
 */
export async function resolveInstagramProfile(
  handle: string,
): Promise<InstagramProfile | null> {
  const normalized = normalizeHandle(handle);
  if (normalized === "") {
    throw new Error("instagram-public: handle is required");
  }

  let lastRetryReason = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await fetchOnce(normalized);

    switch (result.kind) {
      case "not_found":
        return null;

      case "fatal":
        throw new Error(`instagram-public: ${result.reason}`);

      case "retry":
        lastRetryReason = result.reason;
        // Back off before the next attempt; skip the wait on the final pass.
        if (attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_BASE_MS * attempt);
          continue;
        }
        // Exhausted retries on a transient failure: surface it, don't silently
        // pretend the user is missing.
        throw new Error(
          `instagram-public: gave up after ${MAX_ATTEMPTS} attempts ` +
            `(last: ${lastRetryReason})`,
        );

      case "ok": {
        const pk = toPk(result.user.id);
        if (pk === null) {
          // 200 with a user object but no usable id — undocumented drift.
          throw new Error(
            "instagram-public: response missing data.user.id",
          );
        }
        const profile: InstagramProfile = {
          handle: normalized,
          pk,
          followers: toFollowerCount(result.user.edge_followed_by?.count),
        };
        const fullName = toStringOrUndefined(result.user.full_name);
        if (fullName !== undefined) profile.fullName = fullName;
        const biography = toStringOrUndefined(result.user.biography);
        if (biography !== undefined) profile.biography = biography;
        const pic =
          toStringOrUndefined(result.user.profile_pic_url_hd) ??
          toStringOrUndefined(result.user.profile_pic_url);
        if (pic !== undefined) profile.profilePicUrl = pic;
        if (typeof result.user.is_verified === "boolean") {
          profile.isVerified = result.user.is_verified;
        }
        return profile;
      }
    }
  }

  // Unreachable: the loop either returns or throws on the final attempt.
  return null;
}
