import { NextResponse } from "next/server";
import { runAgentChat, type ChatTurn } from "@/lib/agent.server";
import type { InfluencerSuggestion } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/chat  { messages: {role,content}[], storeId?, brand? }
 *   → { reply, steps, influencers?, visuals?, memory? }
 *
 * The agentic chat turn: the model converses and decides which tools to run
 * (find influencers / send a DM / check replies). Unlike /api/discover it does
 * NOT re-run discovery on every message — follow-ups are just answered.
 */
export async function POST(req: Request) {
  let messages: ChatTurn[] = [];
  let storeId: string | undefined;
  let brand: string | undefined;
  let shortlist: InfluencerSuggestion[] | undefined;
  try {
    const body = (await req.json()) as {
      messages?: ChatTurn[];
      storeId?: string;
      brand?: string;
      shortlist?: InfluencerSuggestion[];
    };
    messages = Array.isArray(body.messages)
      ? body.messages
          .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .map((m) => ({ role: m.role, content: m.content }))
      : [];
    storeId = body.storeId?.trim() || undefined;
    brand = body.brand?.trim() || undefined;
    shortlist = Array.isArray(body.shortlist) ? body.shortlist : undefined;
  } catch {
    /* fall through to validation */
  }

  if (messages.length === 0) {
    return NextResponse.json({ error: "messages are required" }, { status: 400 });
  }

  try {
    const result = await runAgentChat({ messages, storeId, brand, shortlist });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/chat] error:", err);
    return NextResponse.json(
      {
        reply: "Sorry — I hit a snag reaching my tools. Try again in a moment.",
        steps: [] as string[],
      },
      { status: 200 },
    );
  }
}
