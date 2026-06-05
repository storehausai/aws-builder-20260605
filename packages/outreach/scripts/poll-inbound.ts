/**
 * Watch the brand account's DM inbox for influencer replies (unofficial backend).
 * Prints each new inbound and records it to the local store — the same signal the
 * Spectrum worker will relay to the marketer's iMessage (demo step 7).
 *
 *   pnpm ig:poll        # polls every IG_POLL_MS (default 15s)
 */
import "dotenv/config";
import { requirePrivate } from "../src/instagram/factory.js";
import { InboundStore } from "../src/store.js";

async function main() {
  const ig = requirePrivate();
  const store = new InboundStore(process.env.OUTREACH_STORE ?? ".outreach/inbound.json");
  const intervalMs = Number(process.env.IG_POLL_MS ?? 15_000);
  let since = Date.now();

  console.log(`→ polling IG inbox every ${intervalMs / 1000}s for replies …`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const msgs = await ig.pollInbound(since);
      for (const m of msgs) {
        store.record(m);
        since = Math.max(since, m.timestamp);
        console.log(`📩 reply from ${m.senderId}: "${m.text}"`);
      }
    } catch (e) {
      console.warn(`poll error: ${(e as Error).message ?? e}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

main();
