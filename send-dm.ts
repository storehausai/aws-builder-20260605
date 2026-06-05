/**
 * send-dm — try a REAL Instagram DM through the exact same path the dashboard
 * uses: `runOutreach()` from @pebble/pipelines → the web-graphql backend.
 *
 *   pnpm send-dm                          # DM myoons.k (agent composes the message)
 *   pnpm send-dm myoons.k                 # same, explicit handle
 *   pnpm send-dm myoons.k "your message"  # DM with your own text
 *
 * Requires (already in .env): IG_BACKEND=web, IG_SESSIONID=<a browser sessionid>.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load the repo-root .env into process.env (self-contained; no dotenv needed here).
const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, ".env"));

function loadEnv(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2] ?? "";
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

async function main(): Promise<void> {
  const handle = (process.argv[2] ?? "myoons.k").replace(/^@/, "");
  const message = process.argv[3]; // optional — omit to let the agent compose one
  const brand = process.env.SEND_DM_BRAND ?? "storehaus";

  // Same module the /api/outreach route calls.
  const { runOutreach } = (await import("./packages/pipelines/src/index.ts")) as {
    runOutreach: (input: { handle: string; draft?: string; brand?: string }) => Promise<{
      ok: boolean;
      delivered: boolean;
      handle: string;
      message: string;
      threadId?: string;
      error?: string;
      needsConnection?: "instagram";
    }>;
  };

  console.log(`\n📨 Sending DM to @${handle}`);
  console.log(`   backend: ${process.env.IG_BACKEND ?? "(unset)"}  ·  brand: ${brand}`);
  console.log(message ? `   message: "${message}"` : "   (no message given — the agent will compose one)");

  const r = await runOutreach({ handle, draft: message, brand });

  if (r.delivered) {
    console.log(`\n✅ DELIVERED to @${r.handle}`);
    console.log(`   sent: "${r.message}"`);
    console.log(`   id:   ${r.threadId ?? "(none)"}`);
  } else if (r.needsConnection === "instagram") {
    console.log(`\n⚠️  Instagram isn't connected.`);
    console.log(`   Set IG_BACKEND=web and IG_SESSIONID in .env, then retry.`);
    console.log(`   (composed but not sent): "${r.message}"`);
  } else {
    console.log(`\n⚠️  Not delivered: ${r.error ?? "unknown error"}`);
    console.log(`   composed: "${r.message}"`);
  }
  process.exit(r.delivered ? 0 : 1);
}

main().catch((e) => {
  console.error("\n✗ send-dm failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
