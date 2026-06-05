/**
 * REQUIREMENT #5: send DMs — and if Instagram isn't integrated, ASK the user in
 * the chat (don't silently fail). runOutreach composes a DM and, when IG isn't
 * connected, returns needsConnection:"instagram" with the composed message.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runOutreach } from "@pebble/pipelines";

function clearIg(): void {
  delete process.env.IG_USERNAME;
  delete process.env.IG_PASSWORD;
  delete process.env.IG_ACCESS_TOKEN;
  delete process.env.BUTTERBASE_APP_ID; // force the compose step to use the template
  process.env.IG_BACKEND = "private";
}

test("(#5) asks to connect Instagram when it isn't configured — never throws", async () => {
  clearIg();
  const r = await runOutreach({ handle: "@someone", brand: "Acme", draft: "Hi @someone — collab?" });
  assert.equal(r.ok, true);
  assert.equal(r.delivered, false);
  assert.equal(r.needsConnection, "instagram");
  assert.equal(r.channel, "instagram");
  assert.equal(r.handle, "someone", "the @ is stripped");
  assert.ok(r.message.length > 0, "a DM is still composed to show the user");
});

test("(#5) uses a provided draft verbatim", async () => {
  clearIg();
  const draft = "Custom outreach message.";
  const r = await runOutreach({ handle: "creator1", draft });
  assert.equal(r.message, draft);
});
