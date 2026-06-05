/**
 * REQUIREMENT #5 (the "DM must really arrive" plumbing): the swappable Instagram
 * backend. We test the pure, deterministic parts — backend selection, webhook
 * parsing (the official reply path), challenge verification, and the cold-send
 * backend's credential guard — without touching Instagram.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { backendFromEnv, GraphApiBackend, PrivateApiBackend } from "@pebble/outreach";

test("backendFromEnv selects the cold-send (private) or compliant (graph) backend", () => {
  const priv = backendFromEnv({ IG_BACKEND: "private", IG_USERNAME: "u", IG_PASSWORD: "p" } as NodeJS.ProcessEnv);
  assert.equal(priv.kind, "private-api");
  const graph = backendFromEnv({ IG_BACKEND: "graph", IG_ACCESS_TOKEN: "tok" } as NodeJS.ProcessEnv);
  assert.equal(graph.kind, "graph-api");
});

test("GraphApiBackend.parseInbound extracts the sender IGSID + text from a webhook", () => {
  const b = new GraphApiBackend({ accessToken: "t", verifyToken: "v" });
  const msgs = b.parseInbound({
    object: "instagram",
    entry: [
      {
        messaging: [
          { sender: { id: "17841400000" }, recipient: { id: "999" }, timestamp: 1, message: { mid: "m1", text: "interested!" } },
        ],
      },
    ],
  });
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0]!.senderId, "17841400000");
  assert.equal(msgs[0]!.text, "interested!");
});

test("GraphApiBackend.parseInbound skips echoes (our own outbound)", () => {
  const b = new GraphApiBackend({ accessToken: "t" });
  const msgs = b.parseInbound({
    object: "instagram",
    entry: [{ messaging: [{ sender: { id: "1" }, recipient: { id: "2" }, message: { text: "x", is_echo: true } }] }],
  });
  assert.equal(msgs.length, 0);
});

test("verifyChallenge echoes the challenge only when the verify token matches", () => {
  const b = new GraphApiBackend({ accessToken: "t", verifyToken: "secret" });
  const ok = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "secret", "hub.challenge": "42" });
  assert.equal(b.verifyChallenge(ok), "42");
  const bad = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "42" });
  assert.equal(b.verifyChallenge(bad), null);
});

test("PrivateApiBackend refuses to construct without credentials", () => {
  assert.throws(() => new PrivateApiBackend({ username: "", password: "" }), /required/i);
});
