/**
 * Instagram messaging — the swappable backend contract.
 *
 * Two real backends can satisfy this:
 *   • graph-api  (official Meta) — can REPLY to whoever messaged us (we learn their
 *                 IGSID from the inbound webhook). Compliant; cannot cold-address an
 *                 arbitrary @handle (no IGSID without an inbound).
 *   • private-api (unofficial)   — can send to an arbitrary user PK / handle (cold),
 *                 at ToS/ban risk. Inbound via inbox polling/realtime.
 *
 * The rest of the system (the Spectrum provider, the outreach pipeline tool) depends
 * ONLY on this interface, so the demo binds to whichever path we're cleared to use.
 */

export interface IgInboundMessage {
  /** Stable conversation key (the influencer's IGSID, for official). */
  threadId: string;
  /** The influencer's id — pass this back as `recipientId` to reply. */
  senderId: string;
  /** The influencer's @handle, when the provider exposes it (web-graphql does). */
  senderHandle?: string;
  /** Our business account id. */
  recipientId: string;
  text: string;
  /** epoch ms */
  timestamp: number;
  /** vendor-native payload, for debugging / re-parse. */
  raw: unknown;
}

export interface IgSendResult {
  ok: boolean;
  /** provider message id on success. */
  messageId?: string;
  /** HTTP status (0 if the request never left). */
  status: number;
  /** error string on failure. */
  error?: string;
}

export interface InstagramBackend {
  readonly kind: "graph-api" | "private-api" | "web-graphql";
  /**
   * Send a text DM. For graph-api, `recipient` is an IGSID obtained from a prior
   * inbound message. For private-api / web-graphql, `recipient` may be a user PK
   * or @handle (cold).
   */
  sendText(recipient: string, text: string): Promise<IgSendResult>;
  /** Parse a provider webhook body (graph-api) into inbound messages. */
  parseInbound?(body: unknown): IgInboundMessage[];
  /** Pull new inbound messages since `sinceMs` (private-api / web-graphql). */
  pollInbound?(sinceMs: number): Promise<IgInboundMessage[]>;
}
