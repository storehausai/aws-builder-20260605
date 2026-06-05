/**
 * Unofficial Instagram backend — the only path that can send a COLD first DM to
 * an arbitrary influencer (by @handle), which the official Graph API cannot do.
 *
 * Uses `instagram-private-api`, logged in as a dedicated/burner brand account.
 * ⚠️ This violates Instagram's ToS and the sending account can be checkpointed or
 * banned. Mitigations baked in here: SESSION PERSISTENCE (serialize once via
 * `pnpm ig:login`, reuse forever — avoids re-triggering login challenges mid-demo)
 * and a single shared client. Keep volume tiny; use a burner account; consider a
 * residential proxy (IG_PROXY).
 *
 * Cold send:   resolve @handle → user pk → directThread([pk]).broadcastText(text)
 * Inbound:     poll the direct inbox for incoming messages (no webhook exists).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { IgApiClient } from "instagram-private-api";
import type { IgInboundMessage, IgSendResult, InstagramBackend } from "./types.js";

export interface PrivateApiConfig {
  username: string;
  password: string;
  /** Path to the serialized session JSON (default .ig-session.json). */
  sessionPath?: string;
  /** Optional proxy URL (recommended for stability). */
  proxy?: string;
}

export class PrivateApiBackend implements InstagramBackend {
  readonly kind = "private-api" as const;
  private readonly ig = new IgApiClient();
  private readonly cfg: Required<Omit<PrivateApiConfig, "proxy">> & { proxy?: string };
  private ready = false;
  private myPk = "";

  constructor(cfg: PrivateApiConfig) {
    if (!cfg.username || !cfg.password) {
      throw new Error("PrivateApiBackend: IG_USERNAME and IG_PASSWORD are required");
    }
    this.cfg = {
      username: cfg.username,
      password: cfg.password,
      sessionPath: cfg.sessionPath ?? ".ig-session.json",
      proxy: cfg.proxy,
    };
  }

  /** Establish a session (login if no saved state) and persist it. Idempotent. */
  async ensureLogin(): Promise<void> {
    if (this.ready) return;
    if (this.cfg.proxy) this.ig.state.proxyUrl = this.cfg.proxy;
    this.ig.state.generateDevice(this.cfg.username);

    const restored = await this.restoreSession();
    if (!restored) {
      // Fresh login — only happens when no saved session exists.
      await this.ig.account.login(this.cfg.username, this.cfg.password);
      await this.saveSession();
    }
    this.myPk = String(this.ig.state.cookieUserId);
    this.ready = true;
  }

  private async restoreSession(): Promise<boolean> {
    if (!existsSync(this.cfg.sessionPath)) return false;
    try {
      const saved = JSON.parse(readFileSync(this.cfg.sessionPath, "utf8"));
      await this.ig.state.deserialize(saved);
      return true;
    } catch {
      return false;
    }
  }

  private async saveSession(): Promise<void> {
    const serialized = (await this.ig.state.serialize()) as Record<string, unknown>;
    delete serialized.constants; // not portable; regenerated per process
    mkdirSync(dirname(this.cfg.sessionPath), { recursive: true });
    writeFileSync(this.cfg.sessionPath, JSON.stringify(serialized));
  }

  /** Send a DM. `recipient` may be a numeric user pk or an @handle/username. */
  async sendText(recipient: string, text: string): Promise<IgSendResult> {
    try {
      await this.ensureLogin();
      const pk = /^\d+$/.test(recipient)
        ? recipient
        : String(await this.ig.user.getIdByUsername(recipient.replace(/^@/, "")));
      const thread = this.ig.entity.directThread([pk]);
      const res = (await thread.broadcastText(text)) as { item_id?: string };
      return { ok: true, status: 200, messageId: res.item_id };
    } catch (e) {
      return { ok: false, status: 0, error: errMessage(e) };
    }
  }

  /** Poll the direct inbox for incoming text messages newer than `sinceMs`. */
  async pollInbound(sinceMs = 0): Promise<IgInboundMessage[]> {
    await this.ensureLogin();
    const threads = (await this.ig.feed.directInbox().items()) as Array<{
      thread_id: string;
      items?: Array<{ item_type?: string; user_id?: number | string; text?: string; timestamp?: string | number }>;
    }>;
    const out: IgInboundMessage[] = [];
    for (const thread of threads) {
      const item = thread.items?.[0];
      if (!item || item.item_type !== "text" || !item.text) continue;
      if (String(item.user_id) === this.myPk) continue; // skip our own outgoing
      const ts = Math.floor(Number(item.timestamp) / 1000); // IG = microseconds → ms
      if (ts <= sinceMs) continue;
      out.push({
        threadId: thread.thread_id,
        senderId: String(item.user_id),
        recipientId: this.myPk,
        text: item.text,
        timestamp: ts,
        raw: item,
      });
    }
    return out;
  }
}

function errMessage(e: unknown): string {
  const anyE = e as { name?: string; message?: string };
  if (anyE?.name?.includes("Checkpoint")) {
    return "IG checkpoint required — log in to the account in a browser/app to clear it, then re-run `pnpm ig:login`.";
  }
  return anyE?.message ?? String(e);
}

export function privateApiFromEnv(env = process.env): PrivateApiBackend {
  return new PrivateApiBackend({
    username: env.IG_USERNAME ?? "",
    password: env.IG_PASSWORD ?? "",
    sessionPath: env.IG_SESSION_PATH,
    proxy: env.IG_PROXY,
  });
}
