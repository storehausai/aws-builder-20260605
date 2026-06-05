/**
 * L0 raw-fetch envelope. Every provider call is stored verbatim BEFORE
 * normalization, so we can re-normalize without re-fetching (and audit a
 * vendor's response). See ARCHITECTURE.md "the path every datum follows".
 */

import type { Capability, ProviderId, Timestamp } from "./primitives";

export interface RawFetch<TPayload = unknown> {
  providerId: ProviderId;
  capability: Capability;
  /** vendor-native response, stored verbatim in *_fetch_raw (L0) */
  payload: TPayload;
  fetchedAt: Timestamp;
  /** optional vendor request context */
  endpoint?: string;
  actor?: string;
}
