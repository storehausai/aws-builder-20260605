/**
 * Resolve an Instagram LOGIN CHECKPOINT (IgCheckpointError) and persist the
 * session. A fresh account / new device triggers a device-verification
 * challenge; the plain `pnpm ig:login` just throws on it. This script runs the
 * real challenge flow:
 *
 *   1. login -> catch IgCheckpointError
 *   2. ask Instagram to EMAIL a 6-digit code (challenge.auto / selectVerifyMethod)
 *   3. wait for the code to appear in IG_CODE_FILE (default .ig-code.txt)
 *   4. submit it (challenge.sendSecurityCode) -> serialize the session
 *
 * The whole challenge happens in ONE process (the challenge state is in memory).
 * Run it in the background, then write the code (read from the account's email)
 * into .ig-code.txt:  echo 123456 > .ig-code.txt
 *
 *   DOTENV_CONFIG_PATH=/abs/.env pnpm ig:challenge
 */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { IgApiClient, IgCheckpointError } from "instagram-private-api";

const USERNAME = process.env.IG_USERNAME ?? "";
const PASSWORD = process.env.IG_PASSWORD ?? "";
const SESSION_PATH = process.env.IG_SESSION_PATH ?? ".ig-session.json";
const CODE_FILE = process.env.IG_CODE_FILE ?? ".ig-code.txt";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function saveSession(ig: IgApiClient): Promise<void> {
  const s = (await ig.state.serialize()) as Record<string, unknown>;
  delete s.constants;
  mkdirSync(dirname(SESSION_PATH), { recursive: true });
  writeFileSync(SESSION_PATH, JSON.stringify(s));
}

async function waitForCode(): Promise<string> {
  console.log(`→ waiting for the 6-digit code in ${CODE_FILE} (up to 8 min)…`);
  for (let i = 0; i < 160; i++) {
    if (existsSync(CODE_FILE)) {
      const code = readFileSync(CODE_FILE, "utf8").trim();
      if (/^\d{6}$/.test(code)) {
        try {
          unlinkSync(CODE_FILE);
        } catch {
          /* ignore */
        }
        return code;
      }
    }
    await sleep(3000);
  }
  throw new Error("timed out waiting for the code (8 min)");
}

async function requestCode(ig: IgApiClient): Promise<void> {
  // Prefer email (method "1"); fall back to auto() which picks a default method.
  try {
    await ig.challenge.auto(true);
    console.log("→ challenge.auto() sent a code (default method)");
  } catch (e) {
    console.log(`  auto() didn't send (${(e as Error).message}); trying email method…`);
  }
  // Try to force email regardless, so the code lands in the inbox we can read.
  try {
    await ig.challenge.selectVerifyMethod("1");
    console.log("→ requested EMAIL verification code");
  } catch (e) {
    console.log(`  selectVerifyMethod(email) note: ${(e as Error).message}`);
  }
}

async function main(): Promise<void> {
  if (!USERNAME || !PASSWORD) {
    console.error("Set IG_USERNAME and IG_PASSWORD in .env first.");
    process.exit(1);
  }
  const ig = new IgApiClient();
  if (process.env.IG_PROXY) ig.state.proxyUrl = process.env.IG_PROXY;
  ig.state.generateDevice(USERNAME);

  console.log(`→ logging in as ${USERNAME} …`);
  try {
    await ig.account.login(USERNAME, PASSWORD);
    console.log("✓ logged in with no checkpoint.");
    await saveSession(ig);
    console.log(`✓ session saved to ${SESSION_PATH}`);
    return;
  } catch (e) {
    const err = e as { name?: string; message?: string; response?: { body?: unknown } };
    console.log(`  error class: ${err.name}`);
    console.log(`  error message: ${err.message}`);
    console.log(`  response body: ${JSON.stringify(err.response?.body ?? null)}`);
    console.log(`  checkpoint state: ${JSON.stringify(ig.state.checkpoint ?? null)}`);
    const isCheckpoint = e instanceof IgCheckpointError || Boolean(ig.state.checkpoint);
    if (!isCheckpoint) {
      console.error(
        "✗ This is NOT a standard programmatic checkpoint — it's an account-recovery / lock " +
          "response. The account likely must be verified in the Instagram app or web first.",
      );
      process.exit(1);
    }
  }

  console.log("⚠ checkpoint challenge — requesting a verification code.");
  console.log(`  checkpoint: ${JSON.stringify(ig.state.checkpoint)}`);
  await requestCode(ig);
  console.log(`  after request: ${JSON.stringify(ig.state.checkpoint)}`);

  const code = await waitForCode();
  console.log(`→ submitting code ${code} …`);
  const res = await ig.challenge.sendSecurityCode(code);
  console.log(`  result: ${JSON.stringify(res)}`);
  await saveSession(ig);
  console.log(`✓ checkpoint cleared; session saved to ${SESSION_PATH}`);
}

main().catch((e) => {
  console.error(`✗ ${(e as Error)?.message ?? e}`);
  process.exit(1);
});
