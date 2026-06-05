/**
 * Web-GraphQL Instagram backend — the path that actually works in 2026.
 *
 * The unofficial mobile private API (instagram-private-api) is stale and its
 * password login returns bad_password even with correct creds. The official
 * Graph API can't cold-DM. This backend instead drives Instagram's OWN WEB API
 * exactly the way the browser does, authenticated by a stored browser `sessionid`:
 *
 *   1. ensureSession(): GET a logged-in IG web page with the sessionid, follow
 *      redirects while accumulating cookies, and SCRAPE the per-session anti-CSRF
 *      tokens `fb_dtsg` + `lsd` (+ csrf, app revision, actor id) out of the HTML.
 *      These tokens are what every prior attempt lacked (→ 302 / error 1357054).
 *   2. sendText(): resolve @handle→pk, then POST the GraphQL `IGDirectTextSendMutation`
 *      with recipient_igids (works for a brand-new cold thread). Verified working.
 *   3. pollInbound(): GET /api/v1/direct_v2/inbox/ and yield messages from others.
 *
 * No password, no checkpoint, no instagrapi — just a browser session cookie.
 * Caveat: keep volume low + human-paced; automated sends still carry ban risk.
 */
import type { IgInboundMessage, IgSendResult, InstagramBackend } from "./types.js";

const UA =
  process.env.IG_USER_AGENT ??
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
const IG_APP_ID = "936619743392459";
/** Persisted-query id for IGDirectTextSendMutation (override if IG rotates it). */
const SEND_DOC_ID = process.env.IG_SEND_DOC_ID ?? "26911679871773184";

export interface WebGraphqlConfig {
  /** Browser `sessionid` cookie value (URL-encoded form is fine). */
  sessionid: string;
}

interface Tokens {
  fbDtsg: string;
  lsd: string;
  csrf: string;
  rev?: string;
  actorId?: string;
}

export class WebGraphqlBackend implements InstagramBackend {
  readonly kind = "web-graphql" as const;
  private readonly sessionid: string;
  /** The logged-in account's pk (parsed from the sessionid prefix). */
  readonly myPk: string;
  private jar = new Map<string, string>();
  private tokens?: Tokens;

  constructor(cfg: WebGraphqlConfig) {
    if (!cfg.sessionid) throw new Error("WebGraphqlBackend: IG_SESSIONID is required");
    this.sessionid = cfg.sessionid;
    this.myPk = decodeURIComponent(cfg.sessionid).split(":")[0] ?? "";
    this.jar.set("sessionid", cfg.sessionid);
    if (this.myPk) this.jar.set("ds_user_id", this.myPk);
  }

  /* ------------------------- cookie + redirect plumbing ------------------------- */

  private cookieHeader(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private absorb(res: Response): void {
    const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    const cookies = getSetCookie ? getSetCookie.call(res.headers) : splitSetCookie(res.headers.get("set-cookie"));
    for (const sc of cookies) {
      const m = sc.match(/^\s*([^=]+)=([^;]*)/);
      if (m && m[1]) this.jar.set(m[1].trim(), m[2] ?? "");
    }
  }

  /** fetch with manual redirect-follow so cookies accumulate across the 302 hops. */
  private async req(url: string, init: RequestInit = {}, maxRedirs = 5): Promise<Response> {
    let current = url;
    for (let i = 0; i <= maxRedirs; i++) {
      const res = await fetch(current, {
        ...init,
        redirect: "manual",
        headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", ...init.headers, cookie: this.cookieHeader() },
      });
      this.absorb(res);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (loc) {
          current = new URL(loc, current).toString();
          continue;
        }
      }
      return res;
    }
    throw new Error("web-graphql: too many redirects");
  }

  /* ------------------------------- session + tokens ------------------------------ */

  /** Establish cookies and scrape fb_dtsg/lsd. Idempotent within a process. */
  async ensureSession(): Promise<void> {
    if (this.tokens) return;
    const res = await this.req("https://www.instagram.com/");
    const html = await res.text();
    if (/accounts\/login/.test(res.url) || /"viewerId":null/.test(html)) {
      throw new Error("web-graphql: session not authenticated (bad or expired IG_SESSIONID)");
    }
    const fbDtsg = pick(html, /"DTSGInitData",\[\],\{"token":"([^"]+)"/) ?? pick(html, /"dtsg":\{"token":"([^"]+)"/);
    const lsd = pick(html, /"LSD",\[\],\{"token":"([^"]+)"/);
    const csrf = this.jar.get("csrftoken") ?? pick(html, /"csrf_token":"([^"]+)"/) ?? "";
    if (!fbDtsg || !lsd) {
      throw new Error("web-graphql: could not scrape fb_dtsg/lsd (IG markup changed or not logged in)");
    }
    this.tokens = {
      fbDtsg,
      lsd,
      csrf,
      rev: pick(html, /"__spin_r":(\d+)/) ?? pick(html, /"client_revision":(\d+)/),
      actorId: pick(html, /"actorID":"(\d+)"/) ?? this.myPk,
    };
  }

  /** Headers Instagram's web API expects on an XHR (notably sec-fetch-*). */
  private apiHeaders(referer: string): Record<string, string> {
    return {
      "x-ig-app-id": IG_APP_ID,
      "x-csrftoken": this.tokens?.csrf ?? this.jar.get("csrftoken") ?? "",
      "x-requested-with": "XMLHttpRequest",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
      accept: "*/*",
      referer,
    };
  }

  /** Resolve an @handle (or numeric pk) to a numeric user id. */
  async resolvePk(recipient: string): Promise<string> {
    const handle = recipient.replace(/^@/, "").trim();
    if (/^\d+$/.test(handle)) return handle;
    const res = await this.req(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`,
      { headers: this.apiHeaders(`https://www.instagram.com/${handle}/`) },
    );
    const data = (await readJson(res)) as { data?: { user?: { id?: string } } };
    const pk = data?.data?.user?.id;
    if (!pk) throw new Error(`web-graphql: could not resolve @${handle} to a user id`);
    return pk;
  }

  /* ----------------------------------- send -------------------------------------- */

  async sendText(recipient: string, text: string): Promise<IgSendResult> {
    try {
      await this.ensureSession();
      const t = this.tokens!;
      const pk = await this.resolvePk(recipient);
      const variables = {
        ig_thread_igid: null,
        offline_threading_id: randomDigits(19),
        recipient_igids: [pk],
        replied_to_client_context: null,
        replied_to_item_id: null,
        reply_to_message_id: null,
        sampled: null,
        text: { sensitive_string_value: text },
        mentions: [],
        mentioned_user_ids: [],
        commands: null,
        forwarded_from_thread_id: null,
        is_forwarded_from_own_message: null,
        send_attribution: "igd_web_chat_tab:in_thread",
      };
      const body = new URLSearchParams({
        av: t.actorId ?? this.myPk,
        __d: "www",
        __user: "0",
        __a: "1",
        __req: "a",
        dpr: "2",
        __ccg: "EXCELLENT",
        __comet_req: "7",
        fb_dtsg: t.fbDtsg,
        jazoest: jazoest(t.fbDtsg),
        lsd: t.lsd,
        __spin_r: t.rev ?? "",
        __spin_b: "trunk",
        __spin_t: String(Math.floor(Date.now() / 1000)),
        fb_api_caller_class: "RelayModern",
        fb_api_req_friendly_name: "IGDirectTextSendMutation",
        server_timestamps: "true",
        variables: JSON.stringify(variables),
        doc_id: SEND_DOC_ID,
      });
      const res = await fetch("https://www.instagram.com/api/graphql", {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": UA,
          "x-ig-app-id": IG_APP_ID,
          "x-csrftoken": t.csrf,
          "x-fb-friendly-name": "IGDirectTextSendMutation",
          "x-fb-lsd": t.lsd,
          "x-asbd-id": "359341",
          "sec-fetch-site": "same-origin",
          "sec-fetch-mode": "cors",
          "sec-fetch-dest": "empty",
          accept: "*/*",
          origin: "https://www.instagram.com",
          referer: "https://www.instagram.com/direct/new/",
          cookie: this.cookieHeader(),
        },
        body: body.toString(),
      });
      const raw = await res.text();
      if (res.status >= 300 && res.status < 400) {
        return { ok: false, status: res.status, error: "redirected to login — session rejected for write" };
      }
      let json: unknown;
      try {
        json = JSON.parse(raw.replace(/^for\s*\(;;\);/, ""));
      } catch {
        return { ok: false, status: res.status, error: `non-JSON response: ${raw.slice(0, 160)}` };
      }
      const j = json as {
        data?: { xig_direct_text_send_with_slide_messaging_response?: { message_id?: string } };
        errors?: unknown;
        errorSummary?: string;
      };
      const messageId = j.data?.xig_direct_text_send_with_slide_messaging_response?.message_id;
      if (messageId) return { ok: true, status: res.status, messageId };
      return {
        ok: false,
        status: res.status,
        error: j.errorSummary ? String(j.errorSummary) : `send rejected: ${raw.slice(0, 200)}`,
      };
    } catch (e) {
      return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /* ---------------------------------- inbound ------------------------------------ */

  async pollInbound(sinceMs = 0): Promise<IgInboundMessage[]> {
    await this.ensureSession();
    const res = await this.req(
      "https://www.instagram.com/api/v1/direct_v2/inbox/?visual_message_return_type=unseen&thread_message_limit=10&persistentBadging=true&limit=20",
      { headers: this.apiHeaders("https://www.instagram.com/direct/inbox/") },
    );
    const data = (await readJson(res)) as {
      inbox?: {
        threads?: Array<{
          thread_id?: string;
          users?: Array<{ pk?: number | string; username?: string }>;
          items?: Array<RawItem>;
        }>;
      };
    };
    const out: IgInboundMessage[] = [];
    for (const thread of data?.inbox?.threads ?? []) {
      // username lookup so replies render as "@handle replied" not a numeric pk
      const handleByPk = new Map<string, string>();
      for (const u of thread.users ?? []) {
        if (u.pk != null && u.username) handleByPk.set(String(u.pk), u.username);
      }
      for (const item of thread.items ?? []) {
        if (item.item_type !== "text" || !item.text) continue;
        if (String(item.user_id) === this.myPk) continue; // skip our own
        const ts = Math.floor(Number(item.timestamp) / 1000); // IG µs → ms
        if (ts <= sinceMs) continue;
        out.push({
          threadId: String(thread.thread_id ?? item.user_id),
          senderId: String(item.user_id),
          senderHandle: handleByPk.get(String(item.user_id)),
          recipientId: this.myPk,
          text: item.text,
          timestamp: ts,
          raw: item,
        });
      }
    }
    return out.sort((a, b) => a.timestamp - b.timestamp);
  }
}

interface RawItem {
  item_type?: string;
  user_id?: number | string;
  text?: string;
  timestamp?: number | string;
}

export function webGraphqlFromEnv(env = process.env): WebGraphqlBackend {
  const sessionid = env.IG_SESSIONID;
  if (!sessionid) throw new Error("Set IG_SESSIONID (a browser sessionid) for the web-graphql backend.");
  return new WebGraphqlBackend({ sessionid });
}

/* ---------------------------------- helpers ------------------------------------- */

function pick(s: string, re: RegExp): string | undefined {
  const m = s.match(re);
  return m?.[1];
}

/** Read an IG API response as JSON, stripping the anti-JSON-hijack prefix and
 *  surfacing a snippet if the server returned HTML/text (e.g. a sec-fetch block). */
async function readJson(res: Response): Promise<unknown> {
  const raw = (await res.text()).replace(/^for\s*\(;;\);/, "");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`expected JSON, got [${res.status}]: ${raw.slice(0, 120)}`);
  }
}

function randomDigits(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

/** Facebook jazoest = "2" + sum of char codes of the fb_dtsg token. */
function jazoest(token: string): string {
  let sum = 0;
  for (let i = 0; i < token.length; i++) sum += token.charCodeAt(i);
  return `2${sum}`;
}

function splitSetCookie(header: string | null): string[] {
  if (!header) return [];
  // best-effort split when getSetCookie() isn't available
  return header.split(/,(?=[^;]+=)/);
}
