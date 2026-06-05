/**
 * Backend selector. `IG_BACKEND=private` (cold sends, unofficial) or `graph`
 * (compliant reply-only, official). Everything downstream depends only on the
 * InstagramBackend interface, so the demo binds to whichever we're cleared to use.
 */
import type { InstagramBackend } from "./types.js";
import { graphApiFromEnv } from "./graph-api.js";
import { privateApiFromEnv, PrivateApiBackend } from "./private-api.js";

export type IgBackendKind = "private" | "graph";

export function backendFromEnv(env = process.env): InstagramBackend {
  const kind = (env.IG_BACKEND ?? "private").toLowerCase();
  return kind === "graph" ? graphApiFromEnv(env) : privateApiFromEnv(env);
}

/** Narrow to the private backend (for cold sends + inbox polling). */
export function requirePrivate(env = process.env): PrivateApiBackend {
  const b = backendFromEnv(env);
  if (!(b instanceof PrivateApiBackend)) {
    throw new Error("Expected the private-api backend — set IG_BACKEND=private.");
  }
  return b;
}
