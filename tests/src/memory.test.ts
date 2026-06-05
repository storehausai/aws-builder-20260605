/**
 * XTrace memory wrapper (@pebble/memory): reads must NEVER break an agent turn.
 * Without credentials, recall/search degrade gracefully ("" / []) rather than
 * throwing — that resilience is the contract the discovery agent depends on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemory } from "@pebble/memory";

function clearXtrace(): void {
  delete process.env.XTRACE_API_KEY;
  delete process.env.XTRACE_ORG_ID;
}

test("recall degrades to an empty string when XTrace isn't configured", async () => {
  clearXtrace();
  const mem = createMemory();
  const out = await mem.recall("store-1", "which creators actually convert?");
  assert.equal(out, "");
});

test("search degrades to an empty array when XTrace isn't configured", async () => {
  clearXtrace();
  const mem = createMemory();
  const out = await mem.search("store-1", "past outreach");
  assert.deepEqual(out, []);
});
