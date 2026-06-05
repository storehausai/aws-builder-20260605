/**
 * PROOF: given a real Keepa burst (biggest steady-price, ≤1yr), can we retrieve
 * TikTok content posted in [D-7, D]? Mines tag variants from a seed scrape, then
 * deep-paginates the hashtag feed, client-filters to the window, ranks by views.
 */
import { createKeepaAdapter } from "@pebble/providers";
import { findMarketMovers } from "@pebble/engine";

const KEEPA = process.env.KEEPA_API_KEY!;
const SC = process.env.SCRAPECREATORS_API_KEY!;
const SC_BASE = "https://api.scrapecreators.com";
const brand = process.argv[2] ?? "Rael";
const PAGES = Number(process.argv[3] ?? 35);

const decodeMs = (id: unknown): number | null => {
  const s = String(id ?? ""); if (!/^\d+$/.test(s)) return null;
  try { return Number(BigInt(s) >> 32n) * 1000; } catch { return null; }
};
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86400000;

async function hashtagPage(tag: string, cursor: number) {
  const p = new URLSearchParams({ hashtag: tag.replace(/^#/, ""), trim: "false", cursor: String(cursor) });
  const url = `${SC_BASE}/v1/tiktok/search/hashtag?${p}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { "x-api-key": SC }, signal: AbortSignal.timeout(25000) });
      if (!r.ok) return { items: [] as any[], next: null as any };
      const d: any = await r.json();
      return { items: (d.aweme_list ?? d.search_item_list ?? []) as any[], next: d.cursor };
    } catch {
      if (attempt === 2) return { items: [] as any[], next: null as any };
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
  return { items: [] as any[], next: null as any };
}

/** mine co-occurring hashtags + @mentions from a few seed pages. */
async function mineTags(seed: string): Promise<{ tags: string[]; mentions: string[] }> {
  const tagCount = new Map<string, number>(), menCount = new Map<string, number>();
  let cursor = 0;
  for (let i = 0; i < 3; i++) {
    const { items, next } = await hashtagPage(seed, cursor);
    for (const it of items) {
      for (const te of it.text_extra ?? []) {
        if (te.hashtag_name) tagCount.set(te.hashtag_name.toLowerCase(), (tagCount.get(te.hashtag_name.toLowerCase()) ?? 0) + 1);
      }
      const m = String(it.desc ?? "").match(/@[\w.]+/g) ?? [];
      for (const mm of m) menCount.set(mm.toLowerCase(), (menCount.get(mm.toLowerCase()) ?? 0) + 1);
    }
    if (next == null || next === cursor) break; cursor = next;
  }
  const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => `${k}(${c})`);
  return { tags: top(tagCount, 12), mentions: top(menCount, 8) };
}

async function main() {
  // 1) biggest steady-price burst within 1 year
  const keepa = createKeepaAdapter(KEEPA, 1);
  const found = await keepa.resolveBrand(brand, 10);
  const raw = await keepa.getProductsHistory(found.map((f) => f.asin).slice(0, 8));
  const norm = keepa.normalizeProductHistory(raw);
  const byAsin = new Map<string, any[]>();
  for (const p of norm.points) { const a = byAsin.get(p.externalId) ?? []; a.push(p); byAsin.set(p.externalId, a); }
  const cutoff = Date.now() - 365 * DAY;
  let best: any = null;
  for (const [asin, pts] of byAsin) {
    pts.sort((a, b) => (a.snapshotDate < b.snapshotDate ? -1 : 1));
    const dates = pts.map((p) => p.snapshotDate); const ranks: number[] = []; let last = 0;
    for (const p of pts) { if (p.rank != null) last = p.rank; ranks.push(p.rank ?? last); }
    const prices = pts.map((p) => p.price ?? null);
    const res = findMarketMovers({ product: { asin }, series: { dates, ranks, prices }, content: [] });
    for (const s of res.spikes) {
      if (s.gate !== "passed") continue;
      const ms = Date.parse(`${s.date}T00:00:00Z`);
      if (ms < cutoff) continue;
      const strength = s.rankFrom - s.rankTo; // bigger rank improvement = bigger burst
      if (!best || strength > best.strength) best = { asin, date: s.date, ms, rankFrom: s.rankFrom, rankTo: s.rankTo, strength, z: s.z };
    }
  }
  if (!best) { console.log(`No steady-price burst within 1 year for ${brand}.`); return; }
  console.log(`BIGGEST STEADY BURST (≤1yr): ${brand} ${best.asin} @ ${best.date}  ${best.rankFrom}->${best.rankTo} (z${Math.round(best.z)})`);
  const lo = best.ms - 7 * DAY, hi = best.ms + DAY;
  console.log(`window [${day(lo)} .. ${day(hi)}]\n`);

  // 2) mine tag/mention variants
  const mined = await mineTags(brand);
  console.log("mined hashtags:", mined.tags.join(", "));
  console.log("mined mentions:", mined.mentions.join(", "), "\n");

  // 3) deep-collect across brand tag + top mined tags, dedupe, parse ts
  const tags = [brand.toLowerCase(), ...mined.tags.map((t) => t.split("(")[0]).filter((t) => t !== brand.toLowerCase())].slice(0, 4);
  const seen = new Set<string>(); const all: any[] = [];
  for (const tag of tags) {
    let cursor = 0;
    for (let i = 0; i < PAGES; i++) {
      const { items, next } = await hashtagPage(tag, cursor);
      if (!items.length) break;
      for (const it of items) {
        const id = String(it.aweme_id ?? "");
        if (!id || seen.has(id)) continue; seen.add(id);
        const ms = decodeMs(it.aweme_id);
        all.push({ ms, author: it.author?.unique_id ?? it.author?.nickname, views: it.statistics?.play_count, desc: String(it.desc ?? "").slice(0, 70), tag });
      }
      if (next == null || next === cursor) break; cursor = next;
    }
  }
  const dated = all.filter((x) => x.ms);
  const inWin = dated.filter((x) => x.ms >= lo && x.ms <= hi).sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  const span = dated.length ? `${day(Math.min(...dated.map((d) => d.ms)))} .. ${day(Math.max(...dated.map((d) => d.ms)))}` : "n/a";
  console.log(`collected ${dated.length} unique dated posts across ${tags.length} tag(s); span ${span}`);
  console.log(`\n>>> IN-WINDOW posts [${day(lo)}..${day(hi)}]: ${inWin.length}`);
  for (const p of inWin.slice(0, 10)) console.log(`  ${day(p.ms)} @${p.author} views=${p.views} #${p.tag} "${p.desc}"`);
}
main().catch((e) => { console.error(e); process.exit(1); });
