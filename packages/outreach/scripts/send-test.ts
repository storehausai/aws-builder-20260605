/**
 * Milestone A — outbound side. Send a real Instagram DM and prove it arrives.
 *
 *   pnpm ig:send-test "<message>" [recipientIGSID]
 *
 * If no IGSID is given, it replies to the most recent inbound sender captured by
 * the webhook server (.outreach/inbound.json). That's the compliant flow: the
 * tester DMs the business first (opening the 24h window + giving us their IGSID),
 * then this replies. For the unofficial/cold path, pass a handle once that backend
 * is wired (swap the backend import — the interface is identical).
 */
import "dotenv/config";
import { backendFromEnv } from "../src/instagram/factory.js";
import { InboundStore } from "../src/store.js";

async function main() {
  const text = process.argv[2] ?? "Hey! This is the pebble outreach test — did this DM arrive? 👋";
  let recipient = process.argv[3];
  const backend = backendFromEnv();

  // private backend → cold-send by @handle or pk (recipient required).
  // graph backend → reply to the last inbound IGSID if none given.
  if (!recipient) {
    if (backend.kind === "private-api") {
      console.error('Pass an influencer handle or pk: pnpm ig:send-test "hi" <@handle>');
      process.exit(1);
    }
    const store = new InboundStore(process.env.OUTREACH_STORE ?? ".outreach/inbound.json");
    const last = store.lastSenderId();
    if (!last) {
      console.error(
        "No recipient given and no inbound captured (graph backend replies to inbound).\n" +
          "→ Run `pnpm ig:webhook`, have the tester DM the business first, OR pass an IGSID.",
      );
      process.exit(1);
    }
    recipient = last;
    console.log(`(replying to most recent inbound IGSID=${recipient})`);
  }

  console.log(`→ sending via ${backend.kind} to ${recipient}: "${text}"`);
  const result = await backend.sendText(recipient, text);

  if (result.ok) {
    console.log(`✓ sent. message_id=${result.messageId ?? "(none returned)"} status=${result.status}`);
  } else {
    console.error(`✗ failed (status ${result.status}): ${result.error}`);
    process.exit(1);
  }
}

main();
