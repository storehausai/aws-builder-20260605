/**
 * Backend selector. `IG_BACKEND=private` (cold sends, unofficial) or `graph`
 * (compliant reply-only, official). Everything downstream depends only on the
 * InstagramBackend interface, so the demo binds to whichever we're cleared to use.
 */
import type { IgInboundMessage, InstagramBackend } from "./types.js";
import { graphApiFromEnv } from "./graph-api.js";
import { privateApiFromEnv, PrivateApiBackend } from "./private-api.js";
import { webGraphqlFromEnv, WebGraphqlBackend } from "./web-graphql.js";

export type IgBackendKind = "private" | "graph" | "web";

export function backendFromEnv(env = process.env): InstagramBackend {
  const kind = (env.IG_BACKEND ?? "private").toLowerCase();
  if (kind === "graph") return graphApiFromEnv(env);
  if (kind === "web" || kind === "web-graphql") return webGraphqlFromEnv(env);
  return privateApiFromEnv(env);
}

/** Narrow to the private backend (for cold sends + inbox polling). */
export function requirePrivate(env = process.env): PrivateApiBackend {
  const b = backendFromEnv(env);
  if (!(b instanceof PrivateApiBackend)) {
    throw new Error("Expected the private-api backend — set IG_BACKEND=private.");
  }
  return b;
}

/** A backend that can poll the DM inbox (private-api or web-graphql). */
export interface PollingBackend extends InstagramBackend {
  pollInbound(sinceMs: number): Promise<IgInboundMessage[]>;
}

/** Narrow to a backend that supports inbox polling — web-graphql or private. */
export function requirePoller(env = process.env): PollingBackend {
  const b = backendFromEnv(env);
  if (b instanceof WebGraphqlBackend || b instanceof PrivateApiBackend) return b;
  throw new Error("Inbox polling needs IG_BACKEND=web (recommended) or private.");
}
