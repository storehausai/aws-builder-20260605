/**
 * Official Meta backend for Instagram DMs.
 *
 * Works with both messaging flavors (selectable by env, default = the newer
 * "Instagram API with Instagram Login"):
 *   • graph.instagram.com/v21.0  + POST me/messages       (IG user access token)
 *   • graph.facebook.com/v21.0   + POST <PAGE_ID>/messages (Page access token)
 *
 * Inbound DMs arrive by WEBHOOK (Meta POSTs to our callback). We learn the
 * influencer's IGSID from `sender.id` on that inbound event — which is the only
 * way to obtain it — and reply with it as `recipient.id` within the 24h window.
 *
 * Send request shape (Instagram messaging):
 *   POST {BASE}/{SEND_PATH}?access_token=...
 *   { "recipient": { "id": "<IGSID>" }, "message": { "text": "..." } }
 */

import type { IgInboundMessage, IgSendResult, InstagramBackend } from "./types.js";

export interface GraphApiConfig {
  /** IG user access token (IG-login flow) or Page access token (Page flow). */
  accessToken: string;
  /** API base, default https://graph.instagram.com/v21.0 */
  base?: string;
  /** Send path, default "me/messages". For the Page flow use "<PAGE_ID>/messages". */
  sendPath?: string;
  /** GET-webhook verification token you set in the Meta app dashboard. */
  verifyToken?: string;
}

const DEFAULT_BASE = "https://graph.instagram.com/v21.0";

export class GraphApiBackend implements InstagramBackend {
  readonly kind = "graph-api" as const;
  private readonly base: string;
  private readonly sendPath: string;
  private readonly token: string;
  readonly verifyToken?: string;

  constructor(cfg: GraphApiConfig) {
    if (!cfg.accessToken) throw new Error("GraphApiBackend: accessToken is required");
    this.token = cfg.accessToken;
    this.base = (cfg.base ?? DEFAULT_BASE).replace(/\/$/, "");
    this.sendPath = (cfg.sendPath ?? "me/messages").replace(/^\//, "");
    this.verifyToken = cfg.verifyToken;
  }

  async sendText(recipientIgsid: string, text: string): Promise<IgSendResult> {
    const url = `${this.base}/${this.sendPath}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          recipient: { id: recipientIgsid },
          message: { text },
        }),
      });
      const bodyText = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(bodyText);
      } catch {
        json = bodyText;
      }
      if (!res.ok) {
        const err =
          (json as { error?: { message?: string } })?.error?.message ??
          bodyText.slice(0, 300);
        return { ok: false, status: res.status, error: err };
      }
      const messageId = (json as { message_id?: string })?.message_id;
      return { ok: true, status: res.status, messageId };
    } catch (e) {
      return { ok: false, status: 0, error: String(e) };
    }
  }

  /**
   * Verify a GET webhook handshake. Returns the challenge string to echo back,
   * or null if the token doesn't match.
   */
  verifyChallenge(query: URLSearchParams): string | null {
    const mode = query.get("hub.mode");
    const token = query.get("hub.verify_token");
    const challenge = query.get("hub.challenge");
    if (mode === "subscribe" && token && token === this.verifyToken) {
      return challenge ?? "";
    }
    return null;
  }

  /**
   * Parse an Instagram messaging webhook body into inbound messages.
   * Shape: { object:"instagram", entry:[ { messaging:[ { sender:{id}, recipient:{id},
   *          timestamp, message:{ mid, text } } ] } ] }
   * Echoes (is_echo) and non-text messages are skipped.
   */
  parseInbound(body: unknown): IgInboundMessage[] {
    const out: IgInboundMessage[] = [];
    const entries = (body as { entry?: unknown[] })?.entry;
    if (!Array.isArray(entries)) return out;
    for (const entry of entries) {
      const events = (entry as { messaging?: unknown[] })?.messaging;
      if (!Array.isArray(events)) continue;
      for (const ev of events) {
        const e = ev as {
          sender?: { id?: string };
          recipient?: { id?: string };
          timestamp?: number;
          message?: { mid?: string; text?: string; is_echo?: boolean };
        };
        const text = e.message?.text;
        if (!text || e.message?.is_echo) continue;
        const senderId = e.sender?.id ?? "";
        out.push({
          threadId: senderId,
          senderId,
          recipientId: e.recipient?.id ?? "",
          text,
          timestamp: e.timestamp ?? Date.now(),
          raw: ev,
        });
      }
    }
    return out;
  }
}

export function graphApiFromEnv(env = process.env): GraphApiBackend {
  return new GraphApiBackend({
    accessToken: env.IG_ACCESS_TOKEN ?? "",
    base: env.IG_GRAPH_BASE,
    sendPath: env.IG_SEND_PATH,
    verifyToken: env.IG_WEBHOOK_VERIFY_TOKEN,
  });
}
