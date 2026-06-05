/**
 * REQUIREMENTS TRACEABILITY — maps every step the user specified to a concrete,
 * present capability in the codebase. This is the "is it all wired?" guard.
 *
 *   1. Start from a brand homepage URL                → onboardFromUrl
 *   2. (UI) big "Find influencers" pill               → apps/web (built; UI not unit-tested here)
 *   3. Search influencers using data, shown in chat   → runDiscovery + findMarketMovers (a–j)
 *   4. Suggest influencers by those steps             → runDiscovery → InfluencerSuggestion[]
 *   5. Send DMs / ask for Instagram integration       → runOutreach + @pebble/outreach
 *   6. Integrate iPhone (iMessage)                     → apps/messaging (Spectrum worker)
 *   7. Reply comes back                                → @pebble/outreach inbound + messaging relay
 *   + RocketRide pipelines, Butterbase schema, XTrace memory all present.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { onboardFromUrl, discoverSimilarCreators, resolveInstagramProfile } from "@pebble/providers";
import { runDiscovery, runOutreach } from "@pebble/pipelines";
import { backendFromEnv } from "@pebble/outreach";
import { createMemory } from "@pebble/memory";
import { findMarketMovers, detectSpikes } from "@pebble/engine";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("step 1 — onboarding from a brand homepage URL exists", () => {
  assert.equal(typeof onboardFromUrl, "function");
});

test("step 3 — discovery orchestration + market-mover engine exist (a–j)", () => {
  assert.equal(typeof runDiscovery, "function");
  assert.equal(typeof findMarketMovers, "function"); // c–h
  assert.equal(typeof detectSpikes, "function"); // d
  assert.equal(typeof discoverSimilarCreators, "function"); // i
});

test("step 5 — outreach (send DM) + Instagram backend exist", () => {
  assert.equal(typeof runOutreach, "function");
  assert.equal(typeof backendFromEnv, "function");
  assert.equal(typeof resolveInstagramProfile, "function");
});

test("XTrace memory wrapper exists", () => {
  assert.equal(typeof createMemory, "function");
});

test("steps 6–7 — the Spectrum messaging worker is present", () => {
  assert.ok(existsSync(join(ROOT, "apps", "messaging", "src", "worker.ts")), "messaging worker");
});

test("RocketRide — the three .pipe graphs are present", () => {
  for (const p of ["discovery.pipe", "outreach.pipe", "ingest.pipe"]) {
    assert.ok(existsSync(join(ROOT, "pipelines", p)), `pipelines/${p}`);
  }
});

test("Butterbase — schema.json is valid JSON with the canonical + outreach tables", () => {
  const schema = JSON.parse(readFileSync(join(ROOT, "butterbase", "schema.json"), "utf8")) as {
    tables?: Record<string, unknown>;
  };
  const tables = schema.tables ?? {};
  for (const t of [
    "brand",
    "commerce_product_snapshot",
    "brand_mention",
    "detected_event",
    "attribution",
    "brand_profile",
    "influencer_candidate",
    "outreach_thread",
    "outreach_message",
  ]) {
    assert.ok(tables[t], `table ${t} present in schema`);
  }
});
