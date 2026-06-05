/**
 * Prove the web-graphql backend end-to-end, fully programmatically:
 *   IG_SESSIONID=... pnpm ig:web [@handle] ["message"]
 * Scrapes fb_dtsg/lsd from the live session, sends a DM, then polls the inbox.
 */
import "dotenv/config";
import { webGraphqlFromEnv } from "../src/instagram/web-graphql.js";

async function main() {
  const handle = process.argv[2] ?? "myoons.k";
  const text = process.argv[3] ?? "Hi from the storehaus web-graphql backend — sent programmatically.";
  const ig = webGraphqlFromEnv();

  console.log("→ ensuring session (scraping fb_dtsg/lsd from the live IG page)…");
  await ig.ensureSession();
  console.log(`✓ authenticated as pk=${ig.myPk}`);

  console.log(`→ sending to @${handle}: "${text}"`);
  const r = await ig.sendText(handle, text);
  console.log("send result:", JSON.stringify(r));

  console.log("→ polling inbox (last few messages)…");
  const inbound = await ig.pollInbound(0);
  if (!inbound.length) console.log("   (no inbound text messages found)");
  for (const m of inbound.slice(-6)) console.log(`   from ${m.senderId}: ${m.text}`);
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
