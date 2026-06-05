/**
 * Shared types for the influencer-outreach demo.
 *
 * The discovery/outreach shapes are re-exported DIRECTLY from the
 * `@pebble/pipelines` contract (the single source of truth) so the UI can never
 * drift from the backend — this is what previously hid the `needsConnection`
 * field and broke the in-chat "connect Instagram" ask. These are type-only
 * re-exports: they erase at compile time and pull no runtime code into the
 * client bundle.
 */

export type {
  InfluencerSuggestion,
  DiscoveryResult,
  OutreachResult,
  PanelInput,
  PanelResult,
} from "@pebble/pipelines";

/* ---- Web-only shapes (no backend contract counterpart) ---- */

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

export interface ConnectionStatus {
  instagram: boolean;
  imessage: boolean;
}
