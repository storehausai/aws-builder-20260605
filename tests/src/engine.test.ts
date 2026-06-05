/**
 * REQUIREMENT #3 (c–h): the market-mover MATH — the moat.
 *   (c) BSR series → (d) detect a ranking burst → (e) was the price steady? →
 *   (f) burst + steady price ⇒ outside traffic → (g) content 0–7 days before →
 *   (h) the most viral creator = the market mover.
 *
 * A fully deterministic fixture: a flat rank at 1000 that bursts to 400 on a
 * known day, engineered to clear the Hampel detector's z / improvement /
 * prominence gates. Then we prove the PRICE GATE: the SAME burst is attributed
 * to a creator when price is flat, and discarded as a discount when price drops.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSpikes, findMarketMovers } from "@pebble/engine";
import type { CreatorMention, MarketMoverInput } from "@pebble/core";

function isoDate(dayOffset: number): string {
  return new Date(Date.UTC(2026, 0, 1) + dayOffset * 86_400_000).toISOString().slice(0, 10);
}

const N = 40;
const SPIKE_INDEX = 30;
const dates = Array.from({ length: N }, (_, i) => isoDate(i));
const ranks = Array.from({ length: N }, (_, i) => (i < SPIKE_INDEX ? 1000 : 400));
const pricesFlat = Array.from({ length: N }, () => 20);
// Price drops to 18 on the burst day → ~10% below the lead-in median (20).
const pricesDiscount = Array.from({ length: N }, (_, i) => (i < SPIKE_INDEX ? 20 : 18));

const viralMention: CreatorMention = {
  creatorHandle: "viralcreator",
  platform: "instagram",
  postedAt: `${isoDate(SPIKE_INDEX - 2)}T12:00:00Z`, // 2 days before the burst, in the 7-day window
  followers: 800_000,
  views: 500_000,
  likes: 40_000,
  comments: 2_000,
  url: "https://instagram.com/p/abc",
  coverUrl: null,
};

const baseInput = (prices: Array<number | null>): MarketMoverInput => ({
  product: { asin: "B0TEST0001", title: "Test Serum" },
  series: { dates, ranks, prices },
  content: [viralMention],
});

test("(d) detectSpikes finds exactly the engineered burst", () => {
  const hits = detectSpikes({ ranks });
  assert.equal(hits.length, 1, "exactly one burst");
  assert.equal(hits[0]!.index, SPIKE_INDEX);
  assert.equal(hits[0]!.rankFrom, 1000);
  assert.equal(hits[0]!.rankTo, 400);
  assert.ok(hits[0]!.z <= -5, "z-score clears the threshold");
});

test("(e/f/g/h) flat price + viral creator in window ⇒ creator_driven attribution", () => {
  const res = findMarketMovers(baseInput(pricesFlat));
  assert.equal(res.spikes.length, 1);
  const spike = res.spikes[0]!;
  assert.equal(spike.gate, "passed", "flat price passes the gate");
  assert.equal(spike.verdict, "creator_driven");
  assert.ok(res.topAttribution, "a market mover is attributed");
  assert.equal(res.topAttribution!.creator.handle, "viralcreator");
});

test("(e) PRICE GATE: same burst with a price drop ⇒ price_drop, NOT attributed", () => {
  const res = findMarketMovers(baseInput(pricesDiscount));
  assert.equal(res.spikes.length, 1);
  const spike = res.spikes[0]!;
  assert.equal(spike.gate, "discounted", "the ≥5% drop is caught");
  assert.equal(spike.verdict, "price_drop");
  assert.equal(res.topAttribution, null, "a discount is never blamed on a creator");
});

test("no content in window ⇒ unexplained (honest, not overclaimed)", () => {
  const res = findMarketMovers({ ...baseInput(pricesFlat), content: [] });
  assert.equal(res.spikes[0]!.verdict, "unexplained");
  assert.equal(res.topAttribution, null);
});
