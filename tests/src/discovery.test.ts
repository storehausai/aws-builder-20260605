/**
 * REQUIREMENT #3 + #4: the a–j discovery chain runs and "the process is shown
 * in the chat" (narrated steps), and the suggestions include the proven market
 * mover. Plus REQUIREMENT: it must never crash the demo (graceful fallback).
 *
 * No external creds/network: the integration test STUBS global fetch so the
 * engine returns a known market mover deterministically.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runDiscovery } from "@pebble/pipelines";

const realFetch = globalThis.fetch;
function clearCreds(): void {
  delete process.env.BUTTERBASE_APP_ID;
  delete process.env.NEXT_PUBLIC_BUTTERBASE_APP_ID;
  delete process.env.APIFY_TOKEN;
}

test("(resilience) runDiscovery never throws and narrates the a–j stages with no creds", async () => {
  clearCreds();
  process.env.ENGINE_URL = "http://127.0.0.1:1"; // connection refused, fast
  const r = await runDiscovery({ text: "find influencers for Acme" });
  assert.equal(typeof r.reply, "string");
  assert.ok(Array.isArray(r.influencers));
  assert.ok(r.steps.length > 0, "the process is shown in chat (narrated steps)");
  const joined = r.steps.join(" | ").toLowerCase();
  assert.match(joined, /bsr|burst|rank/, "narrates the BSR/burst stage (c–f)");
  assert.match(joined, /creator|similar|category/, "narrates the creator-search stage (i)");
});

test("(integration #3) a–j chain surfaces the engine's market mover and narrates it", async () => {
  clearCreds();
  process.env.ENGINE_URL = "http://engine.test";
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes("/market-movers")) {
      return new Response(
        JSON.stringify({
          productTitle: "Acme Serum",
          spikes: [
            { gate: "discounted", verdict: "price_drop" },
            { gate: "passed", verdict: "creator_driven" },
          ],
          topAttribution: { creator: { handle: "viralcreator", followers: 800000, compositeSigma: 3.2 } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("<title>Acme Skincare</title>", { status: 200, headers: { "content-type": "text/html" } });
  }) as typeof fetch;

  try {
    const r = await runDiscovery({ text: "find influencers", brandUrl: "https://acme.example" });
    assert.ok(r.influencers.some((i) => i.handle === "viralcreator"), "the proven mover is suggested (j)");
    const joined = r.steps.join(" | ").toLowerCase();
    assert.match(joined, /market mover|viralcreator/, "narrates who moved the market (h)");
    assert.match(joined, /price-gated|discount/, "narrates the price gate (e)");
    assert.match(r.reply.toLowerCase(), /viralcreator/, "the reply names the market mover");
  } finally {
    globalThis.fetch = realFetch;
  }
});
