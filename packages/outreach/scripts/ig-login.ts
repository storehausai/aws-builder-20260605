/**
 * Establish + persist an Instagram session ONCE, before the demo. Re-using this
 * saved session is what stops a login checkpoint from killing the live demo.
 *
 *   IG_USERNAME=... IG_PASSWORD=... pnpm ig:login
 *
 * On success it writes IG_SESSION_PATH (default .ig-session.json, gitignored).
 * If IG throws a checkpoint, clear it in the IG app/browser, then re-run.
 */
import "dotenv/config";
import { privateApiFromEnv } from "../src/instagram/private-api.js";

async function main() {
  if (!process.env.IG_USERNAME || !process.env.IG_PASSWORD) {
    console.error("Set IG_USERNAME and IG_PASSWORD (a dedicated/burner brand account) in .env first.");
    process.exit(1);
  }
  const ig = privateApiFromEnv();
  console.log(`→ logging in as ${process.env.IG_USERNAME} …`);
  try {
    await ig.ensureLogin();
    console.log(`✓ session established + saved to ${process.env.IG_SESSION_PATH ?? ".ig-session.json"}`);
    console.log("  You can now run `pnpm ig:send-test \"hi\" <@handle>` to cold-DM by handle.");
  } catch (e) {
    console.error(`✗ login failed: ${(e as Error).message ?? e}`);
    process.exit(1);
  }
}

main();
