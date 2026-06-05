/**
 * AI DASHBOARD PANEL (Claude-Artifacts style): generatePanel grounds a data
 * bundle on the real discovery output and returns a COMPLETE self-contained HTML
 * document for the sandboxed iframe. With no AI gateway configured it must still
 * return a grounded static dashboard — never throw, never blank.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePanel } from "@pebble/pipelines";

function clearAi(): void {
  // No Butterbase app → createBb()/chatText throws → falls back to static HTML.
  delete process.env.BUTTERBASE_APP_ID;
  delete process.env.NEXT_PUBLIC_BUTTERBASE_APP_ID;
}

const INFLUENCERS = [
  { handle: "@skincarebyhyram", platform: "instagram", followers: 1_400_000, score: 0.95, rationale: "Authority voice in skincare." },
  { handle: "glowwithava", platform: "instagram", followers: 312_000, score: 0.88, rationale: "High save-rate routines." },
];

test("generatePanel returns a complete, grounded HTML document — never throws", async () => {
  clearAi();
  const r = await generatePanel({ brand: "Rael", influencers: INFLUENCERS });

  assert.equal(r.ok, true);
  assert.ok(r.title.includes("Rael"), "title carries the brand");
  const lower = r.html.toLowerCase();
  assert.ok(lower.includes("<!doctype html") || lower.includes("<html"), "is a full HTML doc");
  assert.ok(lower.includes("</html>"), "is closed");

  // Grounding: the real handles appear; the @ is normalized off.
  assert.ok(r.html.includes("skincarebyhyram"), "handle is rendered");
  assert.ok(r.html.includes("glowwithava"), "second handle is rendered");
});

test("generatePanel handles an empty shortlist without throwing", async () => {
  clearAi();
  const r = await generatePanel({ brandUrl: "getrael.com", influencers: [] });
  assert.equal(r.ok, true);
  assert.ok(r.html.length > 0, "still returns a (header-only) document");
});
