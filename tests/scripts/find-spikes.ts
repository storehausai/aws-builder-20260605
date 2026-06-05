import { detectSpikes } from "@pebble/engine";
import { readFileSync } from "node:fs";
const fixturePath = process.env.ENGINE_FIXTURE_PATH;
if (!fixturePath) throw new Error("set ENGINE_FIXTURE_PATH to a bsr-daily fixture JSON");
const fx = JSON.parse(readFileSync(fixturePath, "utf8"));
let withSpikes = 0;
for (const row of fx.rows) {
  const ranks:number[]=[]; let last=0; for(const r of row.dailyRanks){ if(r!=null) last=r; ranks.push(r??last);}
  const hits = detectSpikes({ ranks });
  if (hits.length) { withSpikes++; console.log(row.asin, "|", String(row.title).slice(0,38), "| spikes:", hits.length, "|", hits.slice(0,2).map((h:any)=>`${h.rankFrom}->${h.rankTo} (z${Math.round(h.z)})`).join(", ")); }
}
console.log(`\n${withSpikes}/${fx.rows.length} products have a detected burst.`);
