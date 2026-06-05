/**
 * Typed clients for the (parallel-owned) backend API routes. Shapes here
 * are FIXED by the backend contract — the UI never changes them.
 */

export interface InfluencerSuggestion {
  handle: string;
  platform: "instagram" | "tiktok" | string;
  pk?: string;
  followers?: number;
  /** cascade / market-mover composite, 0..1. */
  score?: number;
  rationale: string;
}

export interface Visuals {
  brand?: { name: string; category?: string; logo?: string };
  competitors?: { name: string; logo?: string }[];
  chart?: { points: { date: string; rank: number; spike: boolean }[]; productTitle?: string } | null;
  creators?: { handle: string; avatar?: string; followers?: number; verified?: boolean; score?: number; rationale?: string }[];
}

/** A persisted influencer candidate (a row of `influencer_candidate`). */
export interface StoredInfluencer {
  id: string;
  platform: "instagram" | "tiktok" | "youtube" | string;
  handle: string;
  followers: number | null;
  /** cascade / market-mover composite, 0..1. */
  score: number | null;
  rationale: string;
  /** suggested | contacted | replied | … */
  status: string;
  createdAt: string;
}

/** A single outreach message in an influencer's conversation history. */
export interface OutreachMessage {
  id: string;
  direction: "inbound" | "outbound";
  channel: string;
  body: string;
  sentAt: string;
}

export interface DiscoveryResult {
  steps: string[];
  reply: string;
  influencers: InfluencerSuggestion[];
  visuals?: Visuals;
  /** What the agent recalled from XTrace about this brand (shown in chat). */
  memory?: string;
}

export interface OutreachResult {
  ok: boolean;
  channel: "instagram";
  handle: string;
  message: string;
  delivered: boolean;
  threadId?: string;
  error?: string;
  /** Set when delivery is blocked purely because IG isn't connected yet. */
  needsConnection?: "instagram";
}

export interface BrandInfo {
  storeId?: string;
  name: string;
  category?: string;
  summary?: string;
  competitors?: string[];
  seedAsins?: string[];
  brandUrl?: string;
}

export interface OnboardResult {
  storeId: string;
  brand: BrandInfo;
}

export interface ReplyItem {
  id: string;
  handle: string;
  body: string;
  channel: string;
  sentAt: string;
}

export interface RepliesResult {
  replies: ReplyItem[];
}

/** The AI-generated dashboard artifact (a complete self-contained HTML doc). */
export interface PanelResult {
  ok: boolean;
  title: string;
  html: string;
  /** model id that wrote it, or "fallback". */
  source: string;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: string };
      detail = j.error ?? "";
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export function onboard(brandUrl: string): Promise<OnboardResult> {
  return postJson<OnboardResult>("/api/onboard", { brandUrl });
}

export async function getBrand(storeId: string): Promise<BrandInfo> {
  const res = await fetch(
    `/api/brand?storeId=${encodeURIComponent(storeId)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Failed to load brand (${res.status})`);
  return (await res.json()) as BrandInfo;
}

export function discover(
  text: string,
  storeId?: string,
): Promise<DiscoveryResult> {
  return postJson<DiscoveryResult>("/api/discover", { text, storeId });
}

export async function getInfluencers(
  storeId: string,
): Promise<StoredInfluencer[]> {
  const res = await fetch(
    `/api/influencers?storeId=${encodeURIComponent(storeId)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return [];
  const body = (await res.json()) as { influencers?: StoredInfluencer[] };
  return body.influencers ?? [];
}

export async function getInfluencerMessages(
  storeId: string,
  influencerId: string,
): Promise<OutreachMessage[]> {
  const res = await fetch(
    `/api/influencers/${encodeURIComponent(influencerId)}/messages?storeId=${encodeURIComponent(storeId)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return [];
  const body = (await res.json()) as { messages?: OutreachMessage[] };
  return body.messages ?? [];
}

export function outreach(input: {
  handle: string;
  draft?: string;
  brand?: string;
  storeId?: string;
}): Promise<OutreachResult> {
  return postJson<OutreachResult>("/api/outreach", input);
}

export function generatePanel(input: {
  brand?: string;
  brandUrl?: string;
  influencers: InfluencerSuggestion[];
}): Promise<PanelResult> {
  return postJson<PanelResult>("/api/generate-panel", input);
}

export async function getReplies(
  storeId?: string,
  since?: string,
): Promise<ReplyItem[]> {
  const params = new URLSearchParams();
  if (storeId) params.set("storeId", storeId);
  if (since) params.set("since", since);
  const res = await fetch(`/api/replies?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  const body = (await res.json()) as RepliesResult;
  return body.replies ?? [];
}
