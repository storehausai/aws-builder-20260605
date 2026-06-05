import {
  createBb,
  insertReturning,
  unwrapMaybe,
  upsertReturning,
  type Bb,
} from "@pebble/bb";
import type { InfluencerSuggestion } from "@pebble/pipelines";
import type { BrandOnboarding } from "@pebble/providers";
import type { StoredInfluencer } from "@/lib/api";

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
): Promise<string> {
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
}

/**
 * Persist (upsert) the brand_profile for a store. brand_profile has no unique
 * index on store_id, so we emulate upsert here: update the existing row when
 * present, else insert. Re-onboarding the same store updates in place.
 */
export async function persistBrandProfile(
  bb: Bb,
  storeId: string,
  brand: BrandPayload,
): Promise<void> {
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
    if (res.error) throw new Error(`brand_profile update: ${String(res.error)}`);
  } else {
    const res = await bb.from("brand_profile").insert(row);
    if (res.error) throw new Error(`brand_profile insert: ${String(res.error)}`);
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
  } catch {
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
        // Non-fatal: log and keep going with the rest.
        console.warn("[brand.server] candidate insert failed:", res.error);
      }
    } catch (err) {
      console.warn("[brand.server] candidate persist error:", err);
    }
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
    console.warn("[brand.server] listCandidates failed:", err);
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
  } catch {
    return null;
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
      console.warn("[brand.server] outreach_message insert failed:", msg.error);
    }

    // Flip candidate status to 'contacted' (best-effort).
    await bb
      .from("influencer_candidate")
      .update({ status: "contacted" })
      .eq("id", opts.candidateId);

    return thread.id;
  } catch (err) {
    console.warn("[brand.server] recordOutreach error:", err);
    return null;
  }
}

/* ------------------------------- helpers ------------------------------- */

interface RawCandidate {
  id: string;
  platform?: string | null;
  handle?: string | null;
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
