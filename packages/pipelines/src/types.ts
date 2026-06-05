/**
 * Public contract for @pebble/pipelines.
 *
 * The web app and the messaging worker are coded against EXACTLY these shapes —
 * do not change them. The orchestration layer (RocketRide primary / Butterbase
 * fallback) hides behind these types so callers never see which path ran.
 */

export interface InfluencerSuggestion {
  handle: string;
  platform: "instagram" | "tiktok" | string;
  /** IG numeric user id (for DM send), when resolved. */
  pk?: string;
  followers?: number;
  /** cascade / market-mover composite, 0..1. */
  score?: number;
  rationale: string;
}

export interface DiscoveryResult {
  /** The agent's prose reply to show in chat. */
  reply: string;
  /** Narrated work, one line per step (step 3 of the demo). */
  steps: string[];
  influencers: InfluencerSuggestion[];
}

export interface OutreachResult {
  ok: boolean;
  channel: "instagram";
  handle: string;
  /** The composed DM body (sent or not). */
  message: string;
  /** True only when the IG send actually succeeded. */
  delivered: boolean;
  threadId?: string;
  error?: string;
  /**
   * Set when delivery is blocked purely because Instagram isn't connected yet.
   * The chat surfaces this as an in-conversation ask ("Connect Instagram to
   * send this DM") rather than a silent failure (demo step 5).
   */
  needsConnection?: "instagram";
}

export interface DiscoveryInput {
  text: string;
  brandUrl?: string;
  storeId?: string;
  /**
   * Stable per-conversation id (e.g. the Spectrum iMessage `space.id`). Lets one
   * messaging conversation map to one chat/context — used as the XTrace conv_id
   * scope so memory stays continuous within a thread.
   */
  convId?: string;
}

export interface OutreachInput {
  handle: string;
  /** Optional pre-written draft; when omitted we compose one. */
  draft?: string;
  brand?: string;
  storeId?: string;
}

export interface PanelInput {
  /** Brand display name (falls back to the host of brandUrl). */
  brand?: string;
  brandUrl?: string;
  /** The discovery output the dashboard is grounded on. */
  influencers: InfluencerSuggestion[];
}

export interface PanelResult {
  ok: boolean;
  title: string;
  /** A COMPLETE self-contained HTML document, rendered in a sandboxed iframe. */
  html: string;
  /** The model id that wrote it, or "fallback" for the static dashboard. */
  source: string;
}

export interface ReplyMessage {
  /** Stable id (thread + timestamp) so the chat can dedupe. */
  id: string;
  /** The influencer's @handle (or pk if the handle is unknown). */
  handle: string;
  body: string;
  channel: "instagram";
  /** ISO timestamp. */
  sentAt: string;
}
