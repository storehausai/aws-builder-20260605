import {
  createBb,
  insertReturning,
  unwrap,
  unwrapMaybe,
  upsertReturning,
  upsertRows,
  type Bb,
} from "@pebble/bb";
import type { InfluencerSuggestion } from "@pebble/pipelines";
import type { BrandOnboarding } from "@pebble/providers";
import type { StoredInfluencer, OutreachMessage } from "@/lib/api";

/**
 * Shared Butterbase persistence helpers for the brand / onboarding /
 * discovery / outreach routes. Every helper is written so the route handlers
 * can call them best-effort: reads return `null`/`[]` on any failure, and
 * writes throw only locally (callers wrap them in try/catch and never surface a
 * crash to the client).
 *
 * Tables (butterbase/schema.json):
 *   stores(id, owner_id, name, slug, created_at, updated_at)
 *   brand_profile(id, store_id, homepage_url, name, category, summary,
 *                 seed_asins jsonb, competitors jsonb, created_at)
 *   influencer_candidate(id, store_id, platform, handle, platform_pk,
 *                        followers, score, rationale, status, created_at)
 *   outreach_thread(id, candidate_id, store_id, ig_thread_id, state,
 *                   marketer_imsg, created_at)
 *   outreach_message(id, thread_id, direction, channel, body, sent_at)
 */

/** Fixed demo owner for stores created from the onboarding flow. */
export const DEMO_OWNER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * DB-unavailable handling.
 *
 * The Butterbase service key in use may have LLM credits but not own the
 * Butterbase app, in which case every DB call throws RESOURCE_NOT_FOUND /
 * "App not found". That's expected and non-fatal for the (store-less) demo
 * flow, so we suppress it: log a SINGLE one-time warning and then degrade
 * silently. Any other (unexpected) error still warns, but no helper ever
 * throws out of the DB layer.
 */
let dbUnavailableWarned = false;

/** True when the error is the known "Butterbase app not owned / not found" failure. */
function isDbUnavailableError(err: unknown): boolean {
  const text = (() => {
    if (!err) return "";
    if (typeof err === "string") return err;
    if (err instanceof Error) return `${err.message} ${String((err as { code?: unknown }).code ?? "")}`;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  })().toLowerCase();
  return (
    text.includes("resource_not_found") ||
    text.includes("app not found") ||
    text.includes("app_id")
  );
}

/**
 * Central, non-throwing error sink for every DB helper. Suppresses the known
 * DB-unavailable error to a one-time warning; warns once-per-call for anything
 * unexpected. Never rethrows.
 */
function handleDbError(scope: string, err: unknown): void {
  if (isDbUnavailableError(err)) {
    if (!dbUnavailableWarned) {
      dbUnavailableWarned = true;
      console.warn(
        `[brand.server] Butterbase DB unavailable (App not found / RESOURCE_NOT_FOUND); ` +
          `degrading silently for the rest of this process. First seen in ${scope}.`,
      );
    }
    return;
  }
  console.warn(`[brand.server] ${scope} failed:`, err);
}

/** The brand shape returned by the API (mirrors BrandOnboarding's fields). */
export interface BrandPayload {
  name: string;
  category: string;
  summary: string;
  competitors: string[];
  seedAsins: string[];
  homepageUrl: string;
}

/** Returns a Bb client, or null when Butterbase isn't configured. */
export function tryCreateBb(): Bb | null {
  if (
    !process.env.BUTTERBASE_APP_ID &&
    !process.env.NEXT_PUBLIC_BUTTERBASE_APP_ID
  ) {
    return null;
  }
  try {
    return createBb();
  } catch {
    return null;
  }
}

/** Derive a stable slug from a homepage URL (the registrable-ish domain label). */
export function slugFromUrl(url: string): string {
  const raw = (url ?? "").trim();
  let host = raw;
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    host = new URL(withScheme).hostname;
  } catch {
    host = raw.replace(/^https?:\/\//i, "").split(/[/?#]/)[0] ?? raw;
  }
  host = host.replace(/^www\./i, "");
  const slug = host
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "store";
}

/**
 * Ensure a `stores` row exists for this brand (keyed by slug) and return its id.
 * Upserts on slug so re-onboarding the same domain reuses the same store.
 */
export async function ensureStore(
  bb: Bb,
  opts: { slug: string; name: string; ownerId?: string },
): Promise<string | null> {
  try {
    const row = await upsertReturning<{ id: string }>(
      bb,
      "stores",
      {
        slug: opts.slug,
        name: opts.name,
        owner_id: opts.ownerId ?? DEMO_OWNER_ID,
        updated_at: new Date().toISOString(),
      },
      ["slug"],
      "id",
    );
    return row.id;
  } catch (err) {
    handleDbError("ensureStore", err);
    return null;
  }
}

/**
 * Persist (upsert) the brand_profile for a store. brand_profile has no unique
 * index on store_id, so we emulate upsert here: update the existing row when
 * present, else insert. Re-onboarding the same store updates in place.
 */
export async function persistBrandProfile(
  bb: Bb,
  storeId: string | null,
  brand: BrandPayload,
): Promise<void> {
  // No store (e.g. ensureStore degraded because the DB is unavailable) — skip.
  if (!storeId) return;
  const row = {
    store_id: storeId,
    homepage_url: brand.homepageUrl,
    name: brand.name,
    category: brand.category,
    summary: brand.summary,
    // The Butterbase SDK requires jsonb columns to be pre-serialized JSON text
    // (a raw JS array is rejected with VALIDATION_INVALID_INPUT / pg 22P02).
    seed_asins: JSON.stringify(brand.seedAsins ?? []),
    competitors: JSON.stringify(brand.competitors ?? []),
  };

  try {
    const existing = unwrapMaybe(
      await bb
        .from("brand_profile")
        .select("id")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ) as { id: string } | null;

    if (existing?.id) {
      const res = await bb
        .from("brand_profile")
        .update(row)
        .eq("id", existing.id);
      if (res.error) handleDbError("persistBrandProfile (update)", res.error);
    } else {
      const res = await bb.from("brand_profile").insert(row);
      if (res.error) handleDbError("persistBrandProfile (insert)", res.error);
    }
  } catch (err) {
    handleDbError("persistBrandProfile", err);
  }
}

/** Read the latest brand_profile for a store, or null if none / unconfigured. */
export async function getBrandProfile(
  storeId: string,
): Promise<BrandPayload | null> {
  const bb = tryCreateBb();
  if (!bb) return null;
  try {
    const row = unwrapMaybe(
      await bb
        .from("brand_profile")
        .select(
          "homepage_url, name, category, summary, seed_asins, competitors",
        )
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ) as RawBrandProfile | null;
    if (!row) return null;
    return {
      name: row.name ?? "",
      category: row.category ?? "",
      summary: row.summary ?? "",
      competitors: toStringArray(row.competitors),
      seedAsins: toStringArray(row.seed_asins),
      homepageUrl: row.homepage_url ?? "",
    };
  } catch (err) {
    handleDbError("getBrandProfile", err);
    return null;
  }
}

/**
 * Best-effort persist discovery results into influencer_candidate. There's no
 * unique index on (store_id, handle), so we select-then-insert: skip candidates
 * that already exist for the store, insert the rest. Never throws.
 */
export async function persistCandidates(
  bb: Bb,
  storeId: string,
  influencers: InfluencerSuggestion[],
): Promise<void> {
  for (const inf of influencers) {
    const handle = (inf.handle ?? "").replace(/^@/, "").trim();
    if (!handle) continue;
    try {
      const exists = unwrapMaybe(
        await bb
          .from("influencer_candidate")
          .select("id")
          .eq("store_id", storeId)
          .eq("handle", handle)
          .maybeSingle(),
      );
      if (exists) continue;

      const res = await bb.from("influencer_candidate").insert({
        store_id: storeId,
        platform: inf.platform ?? "instagram",
        handle,
        platform_pk: inf.pk ?? null,
        followers: inf.followers ?? null,
        score: inf.score ?? null,
        rationale: inf.rationale ?? "",
        status: "suggested",
      });
      if (res.error) {
        // Non-fatal: suppress the DB-unavailable case, then stop trying the
        // remaining candidates (they'd all hit the same wall and spam the log).
        if (isDbUnavailableError(res.error)) {
          handleDbError("persistCandidates", res.error);
          return;
        }
        handleDbError("persistCandidates (insert)", res.error);
      }
    } catch (err) {
      handleDbError("persistCandidates", err);
      // If the whole DB is unavailable, abort the loop rather than retry per-row.
      if (isDbUnavailableError(err)) return;
    }
  }
}

/**
 * READ-BEFORE-FETCH: return previously-discovered candidates for a store that
 * are still fresh (created within `ttlMs`), so a repeat discovery can reuse them
 * and skip the expensive Apify search entirely. Deduped by handle (highest score
 * wins) and sorted by score desc. Returns [] on any miss/failure — the caller
 * then falls back to a live discovery, so this never blocks the flow.
 */
export async function getFreshCandidates(
  storeId: string,
  ttlMs: number,
): Promise<InfluencerSuggestion[]> {
  const bb = tryCreateBb();
  if (!bb) return [];
  try {
    const rows = unwrap(
      await bb
        .from("influencer_candidate")
        .select("platform, handle, platform_pk, followers, score, rationale, created_at")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(60),
    ) as RawCandidate[];

    const cutoff = Date.now() - ttlMs;
    const byHandle = new Map<string, InfluencerSuggestion>();
    for (const r of rows ?? []) {
      if (r.created_at && new Date(r.created_at).getTime() < cutoff) continue;
      const handle = (r.handle ?? "").replace(/^@/, "").trim();
      if (!handle) continue;
      const cand: InfluencerSuggestion = {
        handle,
        platform: r.platform ?? "instagram",
        pk: r.platform_pk ?? undefined,
        followers: numOrUndef(r.followers),
        score: numOrUndef(r.score),
        rationale: r.rationale ?? "",
      };
      const prev = byHandle.get(handle);
      if (!prev || (cand.score ?? 0) > (prev.score ?? 0)) byHandle.set(handle, cand);
    }
    return [...byHandle.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  } catch (err) {
    handleDbError("getFreshCandidates", err);
    return [];
  }
}

/**
 * List the persisted influencer candidates for a store, ordered best-fit first
 * (highest score, then most recent). Best-effort: returns [] on any failure or
 * when Butterbase isn't configured. Powers the Influencers sidebar tab.
 */
export async function listCandidates(
  storeId: string,
): Promise<StoredInfluencer[]> {
  const bb = tryCreateBb();
  if (!bb) return [];
  try {
    const rows = (unwrapMaybe(
      await bb
        .from("influencer_candidate")
        .select(
          "id, platform, handle, followers, score, rationale, status, created_at",
        )
        .eq("store_id", storeId)
        .order("created_at", { ascending: false }),
    ) ?? []) as RawCandidate[];

    return rows
      .map((r) => ({
        id: r.id,
        platform: r.platform ?? "instagram",
        handle: (r.handle ?? "").replace(/^@/, ""),
        followers: r.followers ?? null,
        score: r.score ?? null,
        rationale: r.rationale ?? "",
        status: r.status ?? "suggested",
        createdAt: r.created_at ?? "",
      }))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  } catch (err) {
    handleDbError("listCandidates", err);
    return [];
  }
}

/** A profile resolved from / written to the persistent `social_account` cache. */
export interface CachedProfile {
  pk?: string;
  handle: string;
  avatarUrl?: string;
  followers?: number;
  verified?: boolean;
  displayName?: string;
}

/**
 * PERSISTENT PROFILE CACHE (read). Look up a creator's cached IG profile in
 * `social_account` by handle (latest row), used before spending a ScrapeCreators
 * credit. Returns null when absent, avatar-less, or staler than `ttlMs` (IG CDN
 * avatar URLs expire, so we re-fetch occasionally). Never throws.
 */
export async function getCachedProfile(
  handle: string,
  ttlMs: number,
): Promise<CachedProfile | null> {
  const clean = (handle ?? "").toLowerCase().replace(/^@/, "").trim();
  if (!clean) return null;
  const bb = tryCreateBb();
  if (!bb) return null;
  try {
    const row = unwrapMaybe(
      await bb
        .from("social_account")
        .select("platform_account_id, handle, display_name, avatar_url, verified, followers_count, updated_at, last_fetched_at")
        .eq("handle", clean)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ) as RawAccount | null;
    if (!row?.avatar_url) return null;
    const stamp = row.last_fetched_at ?? row.updated_at;
    if (stamp && Date.now() - new Date(stamp).getTime() > ttlMs) return null;
    return {
      pk: row.platform_account_id ?? undefined,
      handle: clean,
      avatarUrl: row.avatar_url ?? undefined,
      followers: numOrUndef(row.followers_count),
      verified: row.verified ?? undefined,
      displayName: row.display_name ?? undefined,
    };
  } catch (err) {
    handleDbError("getCachedProfile", err);
    return null;
  }
}

/**
 * PERSISTENT PROFILE CACHE (write-through). Upsert a resolved profile into
 * `social_account` so cold starts don't re-hit ScrapeCreators. The table's
 * natural key is (platform, platform_account_id), so we can only persist when
 * the IG `pk` is known — without it we skip (the in-memory L1 cache still
 * covers the current request). Best-effort; never throws.
 */
export async function putCachedProfile(p: CachedProfile & { platform?: string }): Promise<void> {
  if (!p.pk) return;
  const handle = (p.handle ?? "").replace(/^@/, "").trim();
  if (!handle) return;
  const bb = tryCreateBb();
  if (!bb) return;
  try {
    const now = new Date().toISOString();
    await upsertRows(
      bb,
      "social_account",
      [
        {
          platform: p.platform ?? "instagram",
          platform_account_id: String(p.pk),
          handle,
          display_name: p.displayName ?? null,
          avatar_url: p.avatarUrl ?? null,
          verified: p.verified ?? null,
          followers_count: p.followers ?? null,
          last_fetched_at: now,
          updated_at: now,
        },
      ],
      ["platform", "platform_account_id"],
    );
  } catch (err) {
    handleDbError("putCachedProfile", err);
  }
}

/**
 * Read the full outreach conversation for one influencer candidate, oldest
 * first — every message across all of the candidate's threads (outbound DMs +
 * inbound replies). Best-effort: returns [] on any failure. Powers the
 * influencer detail drawer's message history.
 */
export async function listInfluencerMessages(
  storeId: string,
  candidateId: string,
): Promise<OutreachMessage[]> {
  const bb = tryCreateBb();
  if (!bb) return [];
  try {
    const threads = (unwrapMaybe(
      await bb
        .from("outreach_thread")
        .select("id")
        .eq("store_id", storeId)
        .eq("candidate_id", candidateId),
    ) ?? []) as { id: string }[];

    if (threads.length === 0) return [];

    const messages: OutreachMessage[] = [];
    for (const thread of threads) {
      const rows = (unwrapMaybe(
        await bb
          .from("outreach_message")
          .select("id, direction, channel, body, sent_at")
          .eq("thread_id", thread.id)
          .order("sent_at", { ascending: true }),
      ) ?? []) as RawMessage[];
      for (const r of rows) {
        messages.push({
          id: r.id,
          direction: r.direction === "inbound" ? "inbound" : "outbound",
          channel: r.channel ?? "instagram",
          body: r.body ?? "",
          sentAt: r.sent_at ?? "",
        });
      }
    }

    return messages.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  } catch (err) {
    handleDbError("listInfluencerMessages", err);
    return [];
  }
}

/** Resolve a candidate id by (store_id, handle), or null when absent. */
export async function findCandidateId(
  bb: Bb,
  storeId: string,
  handle: string,
): Promise<string | null> {
  const clean = (handle ?? "").replace(/^@/, "").trim();
  if (!clean) return null;
  try {
    const row = unwrapMaybe(
      await bb
        .from("influencer_candidate")
        .select("id")
        .eq("store_id", storeId)
        .eq("handle", clean)
        .maybeSingle(),
    ) as { id: string } | null;
    return row?.id ?? null;
  } catch (err) {
    handleDbError("findCandidateId", err);
    return null;
  }
}

/**
 * Find-or-create the influencer_candidate for (store_id, handle) — the CRM
 * guarantee that any creator we DM lands on the Influencers tab. Returns the
 * candidate id, or null when Butterbase isn't configured / on failure.
 *
 * A candidate created here wasn't ranked by discovery, so it has no
 * score/rationale; it's a contact we engaged, so it starts at status
 * 'contacted'. Follower/pk are best-effort enriched from the social_account
 * profile cache (followers don't expire, so we accept any cached age). Never
 * throws — on a lost insert race we re-resolve by handle.
 */
export async function ensureCandidate(
  bb: Bb,
  storeId: string,
  handle: string,
  extras?: { platform?: string; pk?: string | null; followers?: number | null },
): Promise<string | null> {
  const clean = (handle ?? "").replace(/^@/, "").trim();
  if (!clean) return null;

  const existing = await findCandidateId(bb, storeId, clean);
  if (existing) return existing;

  let followers = extras?.followers ?? null;
  let pk = extras?.pk ?? null;
  if (followers == null || !pk) {
    const cached = await getCachedProfile(clean, Number.MAX_SAFE_INTEGER);
    if (cached) {
      followers = followers ?? cached.followers ?? null;
      pk = pk ?? cached.pk ?? null;
    }
  }

  try {
    const row = await insertReturning<{ id: string }>(
      bb,
      "influencer_candidate",
      {
        store_id: storeId,
        platform: extras?.platform ?? "instagram",
        handle: clean,
        platform_pk: pk,
        followers,
        score: null,
        rationale: "",
        status: "contacted",
      },
      "id",
    );
    return row.id;
  } catch (err) {
    // Known DB-unavailable: suppress to a one-time warning, give up quietly.
    if (isDbUnavailableError(err)) {
      handleDbError("ensureCandidate", err);
      return null;
    }
    console.warn("[brand.server] ensureCandidate insert failed:", err);
    // Likely a unique-ish race with a concurrent send — resolve again.
    return findCandidateId(bb, storeId, clean);
  }
}

/**
 * Best-effort record of an outreach thread + its first (outbound) message.
 * Requires an existing candidate; resolve it via findCandidateId before calling.
 * Returns the new thread id, or null on failure. Never throws.
 */
export async function recordOutreach(
  bb: Bb,
  opts: {
    storeId: string;
    candidateId: string;
    body: string;
    channel?: string;
    igThreadId?: string;
    delivered?: boolean;
  },
): Promise<string | null> {
  try {
    const thread = await insertReturning<{ id: string }>(
      bb,
      "outreach_thread",
      {
        candidate_id: opts.candidateId,
        store_id: opts.storeId,
        ig_thread_id: opts.igThreadId ?? null,
        state: opts.delivered ? "sent" : "drafted",
      },
      "id",
    );

    const msg = await bb.from("outreach_message").insert({
      thread_id: thread.id,
      direction: "outbound",
      channel: opts.channel ?? "instagram",
      body: opts.body,
    });
    if (msg.error) {
      handleDbError("recordOutreach (message insert)", msg.error);
    }

    // Flip candidate status to 'contacted' (best-effort).
    await bb
      .from("influencer_candidate")
      .update({ status: "contacted" })
      .eq("id", opts.candidateId);

    return thread.id;
  } catch (err) {
    handleDbError("recordOutreach", err);
    return null;
  }
}

/**
 * One-stop CRM write for a completed outreach, shared by every DM entry point
 * (the /api/outreach route and the chat agent's send_dm tool) so the
 * "every creator we DM appears on the Influencers tab" guarantee can't depend
 * on which path ran. Find-or-creates the candidate, then records the thread +
 * outbound message. A blocked send (needsConnection) reached no one, so nothing
 * is written. Best-effort: resolves silently on any failure, never throws.
 */
export async function persistOutreach(
  storeId: string | undefined,
  handle: string,
  result: {
    message?: string;
    channel?: string;
    threadId?: string;
    delivered?: boolean;
    needsConnection?: unknown;
  },
): Promise<void> {
  if (!storeId || !result.message || result.needsConnection) return;
  const bb = tryCreateBb();
  if (!bb) return;
  try {
    const candidateId = await ensureCandidate(bb, storeId, handle);
    if (!candidateId) return;
    await recordOutreach(bb, {
      storeId,
      candidateId,
      body: result.message,
      channel: result.channel,
      igThreadId: result.threadId,
      delivered: result.delivered,
    });
  } catch (err) {
    handleDbError("persistOutreach", err);
  }
}

/* ------------------------------- helpers ------------------------------- */

interface RawMessage {
  id: string;
  direction?: string | null;
  channel?: string | null;
  body?: string | null;
  sent_at?: string | null;
}

interface RawCandidate {
  id: string;
  platform?: string | null;
  handle?: string | null;
  platform_pk?: string | null;
  followers?: number | null;
  score?: number | null;
  rationale?: string | null;
  status?: string | null;
  created_at?: string | null;
}

interface RawBrandProfile {
  homepage_url?: string | null;
  name?: string | null;
  category?: string | null;
  summary?: string | null;
  seed_asins?: unknown;
  competitors?: unknown;
}

interface RawAccount {
  platform_account_id?: string | null;
  handle?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  verified?: boolean | null;
  followers_count?: number | string | null;
  updated_at?: string | null;
  last_fetched_at?: string | null;
}

/** Coerce a possibly-string numeric column into a finite number, else undefined. */
function numOrUndef(value: unknown): number | undefined {
  if (value == null) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Coerce a jsonb column (string[] | stringified | null) into a string array. */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed
          .map((v) => (typeof v === "string" ? v.trim() : ""))
          .filter(Boolean);
      }
    } catch {
      /* not JSON — treat as a single value */
    }
    return [s];
  }
  return [];
}

/** Convenience: map a BrandOnboarding into the API/persistence BrandPayload. */
export function toBrandPayload(b: BrandOnboarding): BrandPayload {
  return {
    name: b.brand,
    category: b.category,
    summary: b.summary,
    competitors: b.competitors,
    seedAsins: b.seedAsins,
    homepageUrl: b.homepageUrl,
  };
}
