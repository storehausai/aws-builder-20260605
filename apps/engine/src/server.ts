/**
 * @pebble/engine-service — a tiny HTTP wrapper around the pure @pebble/engine
 * math, so RocketRide can call it as a `tool_http_request` node.
 *
 * It reads canonical data from Butterbase (via @pebble/bb), shapes it into the
 * engine's MarketMoverInput, runs findMarketMovers, and returns the result JSON.
 *
 * ENDPOINTS (the contract RocketRide + the web app depend on — DO NOT change shapes):
 *   GET  /health          -> { ok: true }
 *   POST /market-movers   { scope, identifier, storeId? }
 *                         -> { productTitle, spikes, attributed, topAttribution }
 *   POST /attribute       { scope, identifier, eventId?, storeId? }
 *                         -> the spike-content attribution artifact (same shape;
 *                            topAttribution is the attributed creator).
 *
 * RESILIENCE: the demo must not crash. Bad input -> 400. Missing Butterbase env
 * or a failed/empty query -> 200/503 with a clear { error } (never an unhandled
 * throw). Optional fixtures fallback with ENGINE_FIXTURES=1.
 *
 * TEST (with the dev server running on :8787):
 *   curl -s localhost:8787/health
 *   curl -s localhost:8787/market-movers -H 'content-type: application/json' \
 *        -d '{"scope":"brand","identifier":"Rael"}'
 *   curl -s localhost:8787/market-movers -H 'content-type: application/json' \
 *        -d '{"scope":"asin","identifier":"B09G6BWNDP"}'
 *   curl -s localhost:8787/attribute -H 'content-type: application/json' \
 *        -d '{"scope":"brand","identifier":"Rael"}'
 *   # smoke test with no Butterbase configured:
 *   ENGINE_FIXTURES=1 pnpm --filter @pebble/engine-service dev
 */

import "dotenv/config";
import { Hono } from "hono";
import type { Context } from "hono";
import { serve } from "@hono/node-server";
import type { MarketMoverResult } from "@pebble/core";
import {
  runMarketMover,
  runMarketMoverFromFixtures,
  EngineDataError,
  type MarketMoverRequest,
  type MarketMoverScope,
} from "./engine-data.js";

const PORT = Number(process.env.ENGINE_PORT ?? 8787);
const USE_FIXTURES = process.env.ENGINE_FIXTURES === "1";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.post("/market-movers", async (c) => handleEngine(c, "market-movers"));
app.post("/attribute", async (c) => handleEngine(c, "attribute"));

/**
 * Both endpoints share the same read + engine path: /attribute is /market-movers
 * with attribution emphasized (the engine already computes attribution and
 * `topAttribution` in one pass, so the artifact is the same MarketMoverResult).
 * `eventId` lets the caller pin a specific spike's attribution.
 */
async function handleEngine(c: Context, kind: "market-movers" | "attribute") {
  const parsed = await parseRequest(c, kind === "attribute");
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const req = parsed.req;

  try {
    const result = USE_FIXTURES
      ? await runMarketMoverFromFixtures(req)
      : await runMarketMover(req);

    if (kind === "attribute") return c.json(shapeAttribution(result, req.eventId));
    return c.json(result);
  } catch (err) {
    return errorResponse(c, err, kind);
  }
}

interface ParsedOk {
  req: MarketMoverRequest;
}
async function parseRequest(c: Context, allowEventId: boolean): Promise<ParsedOk | { error: string }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { error: "invalid JSON body" };
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const scope = b.scope;
  if (scope !== "brand" && scope !== "asin") {
    return { error: 'scope must be "brand" or "asin"' };
  }
  const identifier = typeof b.identifier === "string" ? b.identifier.trim() : "";
  if (!identifier) return { error: "identifier is required (a brand name or ASIN)" };

  const req: MarketMoverRequest = {
    scope: scope as MarketMoverScope,
    identifier,
    storeId: typeof b.storeId === "string" ? b.storeId : undefined,
    eventId: allowEventId && typeof b.eventId === "string" ? b.eventId : undefined,
  };
  return { req };
}

/**
 * The /attribute artifact: the full MarketMoverResult, but `topAttribution`
 * focused on the requested spike when `eventId` (here interpreted as a spike
 * date or index) is given. Without it, the engine's strongest attribution
 * stands. Shape stays identical so callers can read either endpoint the same way.
 */
function shapeAttribution(result: MarketMoverResult, eventId?: string): MarketMoverResult {
  if (!eventId) return result;
  const focused = result.spikes.find(
    (s) => s.date === eventId || String(s.index) === eventId,
  );
  if (!focused || !focused.attribution) return result;
  return {
    ...result,
    topAttribution: { spike: focused, creator: focused.attribution },
  };
}

function errorResponse(c: Context, err: unknown, kind: string) {
  const msg = err instanceof Error ? err.message : String(err);
  // Expected data problems (no products / no snapshots / brand not cached) and
  // missing-env are operational, not crashes — surface clearly. Butterbase env
  // missing throws "BUTTERBASE_APP_ID ... is required" from createBb().
  const isEnvMissing = /BUTTERBASE_|is required/i.test(msg);
  const isDataError = err instanceof EngineDataError;
  const status: 200 | 503 = isDataError && !isEnvMissing ? 200 : 503;
  console.error(`[${kind}] ${isDataError ? "data" : "error"}: ${msg}`);
  return c.json(
    {
      error: msg,
      hint: isEnvMissing
        ? "set BUTTERBASE_APP_ID + BUTTERBASE_SERVICE_KEY, or run with ENGINE_FIXTURES=1"
        : undefined,
    },
    status,
  );
}

// Last-resort guards so a stray rejection never kills the demo process.
process.on("unhandledRejection", (reason) => {
  console.error("[engine] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[engine] uncaughtException:", err);
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(
    `[engine] listening on http://localhost:${info.port}` +
      (USE_FIXTURES ? " (ENGINE_FIXTURES=1 — reading pebble fixture, no Butterbase)" : ""),
  );
});

export { app };
