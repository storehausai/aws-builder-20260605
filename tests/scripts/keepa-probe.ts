/**
 * Live Keepa probe — confirm the a–j data path works on real data + token cost.
 *   set -a; source .env; set +a; pnpm --filter @pebble/tests exec tsx ../../tests/scripts/keepa-probe.ts
 */
import { createKeepaAdapter } from "@pebble/providers";
import { detectSpikes } from "@pebble/engine";

const key = process.env.KEEPA_API_KEY;
if (!key) { console.error("no KEEPA_API_KEY"); process.exit(1); }
const keepa = createKeepaAdapter(key, 1); // domain 1 = amazon.com

async function main() {
  for (const brand of ["Rael", "Cora"]) {
    console.log(`\n=== (b) Product Finder: brand "${brand}" ===`);
    let asins: string[] = [];
    try {
      const found = await keepa.resolveBrand(brand, 10);
      asins = found.map((f) => f.asin);
      console.log(`  asins(${asins.length}):`, asins.join(", ") || "(none)");
    } catch (e) { console.log("  resolveBrand ERROR:", (e as Error).message); continue; }
    if (asins.length === 0) continue;

    const probe = asins.slice(0, 5);
    console.log(`\n=== (c) History for ${probe.length} ASIN(s) ===`);
    try {
      const raw = await keepa.getProductsHistory(probe);
      const norm = keepa.normalizeProductHistory(raw);
      console.log(`  products: ${norm.products.length}, points: ${norm.points.length}`);
      // group points by asin
      const byAsin = new Map<string, typeof norm.points>();
      for (const p of norm.points) {
        const arr = byAsin.get(p.externalId) ?? [];
        arr.push(p); byAsin.set(p.externalId, arr);
      }
      for (const [asin, pts] of byAsin) {
        const ranks = pts.map((p) => p.rank).filter((r): r is number => r != null);
        if (!ranks.length) { console.log(`  ${asin}: no rank history`); continue; }
        const filled: number[] = []; let last = ranks[0];
        for (const p of pts) { if (p.rank != null) last = p.rank; filled.push(last); }
        const spikes = detectSpikes({ ranks: filled });
        const title = norm.products.find((q) => q.externalId === asin)?.title ?? "";
        console.log(`  ${asin} | ${String(title).slice(0,40)} | days=${pts.length} ${pts[0]?.snapshotDate}->${pts[pts.length-1]?.snapshotDate} | rankMin=${Math.min(...ranks)} | spikes=${spikes.length}` +
          (spikes.length ? ` (${spikes.slice(0,2).map((s:any)=>`${s.rankFrom}->${s.rankTo} z${Math.round(s.z)} @${s.date??"?"}`).join(", ")})` : ""));
      }
      const pay = raw.payload as { tokensLeft?: number; tokensConsumed?: number };
      console.log(`  tokensConsumed=${pay.tokensConsumed} tokensLeft=${pay.tokensLeft}`);
    } catch (e) { console.log("  history ERROR:", (e as Error).message); }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
