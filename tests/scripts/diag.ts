import { createKeepaAdapter, createScrapeCreatorsAdapter } from "@pebble/providers";
import { findMarketMovers } from "@pebble/engine";
const keepa = createKeepaAdapter(process.env.KEEPA_API_KEY!, 1);
const sc = createScrapeCreatorsAdapter(process.env.SCRAPECREATORS_API_KEY!);

async function main() {
  const found = await keepa.resolveBrand("Cora", 8);
  const raw = await keepa.getProductsHistory(found.map((f) => f.asin).slice(0, 8));
  const norm = keepa.normalizeProductHistory(raw);
  const byAsin = new Map<string, any[]>();
  for (const p of norm.points) { const a = byAsin.get(p.externalId) ?? []; a.push(p); byAsin.set(p.externalId, a); }
  console.log("=== (3/4) burst DATES (Cora) ===");
  for (const [asin, pts] of byAsin) {
    pts.sort((a, b) => (a.snapshotDate < b.snapshotDate ? -1 : 1));
    const dates = pts.map((p) => p.snapshotDate); const ranks: number[] = []; let last = 0;
    for (const p of pts) { if (p.rank != null) last = p.rank; ranks.push(p.rank ?? last); }
    const prices = pts.map((p) => p.price ?? null);
    const res = findMarketMovers({ product: { asin }, series: { dates, ranks, prices }, content: [] });
    for (const s of res.spikes) console.log(`  ${asin} @ ${s.date} (${s.rankFrom}->${s.rankTo}) gate=${s.gate} verdict=${s.verdict}`);
  }
  console.log("\n=== (5) ScrapeCreators TikTok content for 'Cora' ===");
  try {
    const m = sc.normalizeMentions(await sc.searchMentions({ brand: "Cora", platform: "tiktok", maxPages: 1 } as any));
    console.log(`  mentions: ${m.length}`);
    for (const x of m.slice(0, 6)) console.log(`   @${x.creatorHandle} posted=${x.postedAt} views=${x.views}`);
  } catch (e) { console.log("  ERROR:", (e as Error).message); }
}
main().catch((e) => { console.error(e); process.exit(1); });
