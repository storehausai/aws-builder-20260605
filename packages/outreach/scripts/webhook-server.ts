/**
 * Milestone A — inbound side. A tiny webhook receiver for Instagram messaging.
 *
 * Run it, expose it publicly (e.g. `ngrok http 8080`), then set the public
 * `https://.../webhook` URL + your IG_WEBHOOK_VERIFY_TOKEN in the Meta app
 * dashboard (Webhooks → Instagram → subscribe to the `messages` field). When a
 * tester DMs the business account, Meta POSTs it here; we capture the sender's
 * IGSID so send-test.ts can reply.
 *
 *   pnpm ig:webhook        # listens on :8080 (PORT to override)
 */
import "dotenv/config";
import { createServer } from "node:http";
import { graphApiFromEnv } from "../src/instagram/graph-api.js";
import { InboundStore } from "../src/store.js";

const PORT = Number(process.env.PORT ?? 8080);
const STORE = new InboundStore(process.env.OUTREACH_STORE ?? ".outreach/inbound.json");
const backend = graphApiFromEnv();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/webhook") {
    const challenge = backend.verifyChallenge(url.searchParams);
    if (challenge !== null) {
      console.log("✓ webhook verified");
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(challenge);
    } else {
      console.warn("✗ webhook verify failed (token mismatch)");
      res.writeHead(403).end("forbidden");
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/webhook") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = body;
      }
      const messages = backend.parseInbound(parsed);
      for (const m of messages) {
        STORE.record(m);
        console.log(`📩 inbound from IGSID=${m.senderId}: "${m.text}"`);
      }
      // Meta requires a fast 200 or it retries.
      res.writeHead(200).end("EVENT_RECEIVED");
    });
    return;
  }

  res.writeHead(200).end("pebble outreach webhook up");
});

server.listen(PORT, () => {
  console.log(`pebble outreach webhook listening on :${PORT}`);
  console.log(`  GET  /webhook  → verify (token: ${backend.verifyToken ? "set" : "MISSING IG_WEBHOOK_VERIFY_TOKEN"})`);
  console.log(`  POST /webhook  → capture inbound DMs → ${process.env.OUTREACH_STORE ?? ".outreach/inbound.json"}`);
  console.log(`Expose publicly (e.g. ngrok http ${PORT}) and register the URL in the Meta app dashboard.`);
});
