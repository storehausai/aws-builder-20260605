import { NextResponse } from "next/server";
import type { ConnectionStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live connection status for the demo's integrations.
 *
 * This MUST mirror `instagramConfigured()` in `@pebble/pipelines` (outreach.ts)
 * — it's the exact same condition the backend uses to decide whether a DM can
 * actually send. Keeping them in lockstep is what makes the in-chat
 * "connect Instagram" ask honest: the UI never claims "connected" when a send
 * would be blocked.
 */
function instagramConfigured(env = process.env): boolean {
  const backend = (env.IG_BACKEND ?? "private").toLowerCase();
  if (backend === "graph") return Boolean(env.IG_ACCESS_TOKEN);
  if (backend === "web" || backend === "web-graphql") return Boolean(env.IG_SESSIONID);
  return Boolean(env.IG_USERNAME && env.IG_PASSWORD);
}

function imessageConfigured(env = process.env): boolean {
  return Boolean(env.MARKETER_IMESSAGE);
}

export async function GET() {
  const status: ConnectionStatus = {
    instagram: instagramConfigured(),
    imessage: imessageConfigured(),
  };
  return NextResponse.json(status);
}
