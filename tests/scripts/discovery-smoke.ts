/**
 * End-to-end discovery smoke — runs the real a–j chain and prints the narrated
 * steps + suggested influencers. Exercises: onboard (AI) → live Keepa market
 * mover → similar creators (AI) → suggestions. Honest under rate limits.
 *   set -a; source .env; set +a; pnpm --filter @pebble/tests exec tsx ../../tests/scripts/discovery-smoke.ts
 */
import { runAjChain } from "@pebble/pipelines/aj-chain";

async function main() {
  const url = process.argv[2] ?? "https://www.getrael.com";
  console.log(`\n=== runAjChain({ brandUrl: ${url} }) ===\n`);
  const res = await runAjChain({ text: `find influencers for ${url}`, brandUrl: url });
  console.log("--- narrated steps ---");
  res.steps.forEach((s, i) => console.log(`${String(i + 1).padStart(2)}. ${s}`));
  console.log("\n--- suggested influencers ---");
  if (!res.influencers.length) console.log("(none)");
  for (const inf of res.influencers) {
    console.log(`  @${inf.handle}  score=${inf.score}  ${inf.followers ? `${inf.followers} followers  ` : ""}${inf.rationale}`);
  }
  console.log("\n--- reply ---\n" + res.reply);
}
main().catch((e) => { console.error(e); process.exit(1); });
