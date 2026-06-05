import { discoverEnriched, type EnrichedDiscovery } from "@/lib/discovery.server";
import { runOutreach } from "@/lib/pipelines.server";
import { persistOutreach } from "@/lib/brand.server";
import { fetchReplies } from "@/lib/replies.server";
import type { InfluencerSuggestion } from "@/lib/types";
import type { Visuals } from "@/lib/visuals.server";

/**
 * The marketer's agent — "Claude Code, but for marketers."
 *
 * A real chat loop (not a fixed function): the model converses and DECIDES when
 * to call tools. Each user turn replays the conversation, the model optionally
 * calls find_influencers / send_dm / check_replies, we run them, feed the
 * results back, and loop until it answers. Follow-ups that don't need data are
 * just answered — no more "re-run the whole discovery on every message".
 *
 * Talks to the Butterbase AI gateway (OpenAI-compatible) directly so we get
 * native tool-calling, which the @pebble/bb SDK wrapper doesn't expose.
 */

const GATEWAY =
  (process.env.NEXT_PUBLIC_BUTTERBASE_API_URL ?? "https://api.butterbase.ai") + "/v1/chat/completions";
const MODEL = process.env.BB_MODEL ?? "anthropic/claude-sonnet-4.6";
const MAX_STEPS = 6;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AgentChatResult {
  reply: string;
  steps: string[];
  influencers?: InfluencerSuggestion[];
  visuals?: Visuals;
  memory?: string;
}

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}
interface GwMessage {
  role: string;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

function systemPrompt(brand?: string, shortlist?: InfluencerSuggestion[]): string {
  const lines = [
    `You are pebble — an influencer-marketing copilot${brand ? ` for ${brand}` : ""}. Think "Claude Code, but for marketers."`,
    "You help the user find creators who actually MOVE their market (proven by Amazon sales-rank bursts that aren't discount-driven), and reach out to them on Instagram.",
    "",
    "You have tools. Use them ONLY when the request needs fresh data or an action; otherwise just talk naturally and answer from the conversation.",
    "- find_influencers: discover a ranked creator shortlist. Pass `brandUrl` if the user gave a homepage/URL, else a short `query`.",
    "- send_dm: DM ONE creator the user wants to reach (give the @handle; optional `message`).",
    "- check_replies: see if any creator has replied.",
    "",
    "Style: concise, warm, concrete. Narrate briefly what you're doing. Be honest — correlation isn't causation; say signal vs. proof. Never invent creators or numbers; rely on tool results.",
  ];
  if (!brand) {
    lines.push(
      "",
      "You do NOT yet know which COMPETITOR to analyze. The method: find the creators making viral content about a competitor brand — those creators already reach the user's target audience and can move their market too. So before searching, ask the user — in one short, friendly question — for a COMPETITOR's homepage URL (a rival brand in their space), e.g. \"Sure! Which competitor should I analyze? Drop their homepage — like getrael.com — and I'll surface the creators moving their market.\" Do NOT call find_influencers until you have a competitor URL; as soon as the user gives one, call find_influencers with that exact `brandUrl`.",
    );
  }
  if (shortlist?.length) {
    lines.push(
      "",
      "IMPORTANT — you ALREADY have a creator shortlist for this conversation (below). For follow-up questions (\"why this one\", \"who has the most reach\", \"tell me about X\", \"draft a DM\"), answer DIRECTLY from this list. Do NOT call find_influencers again UNLESS the user explicitly asks for a new/different search (different brand or niche, or \"find more / different creators\").",
      "Current shortlist:",
      ...shortlist.slice(0, 12).map(
        (c, i) =>
          `${i + 1}. @${c.handle} — ${c.platform}, ${c.followers ?? "?"} followers, fit ${c.score ?? "?"} — ${c.rationale}`,
      ),
    );
  }
  return lines.join("\n");
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "find_influencers",
      description:
        "Discover the creators making the most-viral content about a COMPETITOR brand — they already reach the user's target market. Pass the competitor's homepage as `brandUrl`. Returns a ranked shortlist with handle, platform, followers, score and a why-this-creator rationale.",
      parameters: {
        type: "object",
        properties: {
          brandUrl: { type: "string", description: "The COMPETITOR brand's homepage URL the user gave." },
          query: { type: "string", description: "Free-text competitor/niche description, if no URL." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_dm",
      description: "Send an Instagram DM to one creator the user approved reaching out to.",
      parameters: {
        type: "object",
        properties: {
          handle: { type: "string", description: "The creator's @handle (without the @ is fine)." },
          message: { type: "string", description: "Optional message text; if omitted, one is composed." },
        },
        required: ["handle"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_replies",
      description: "Check whether any contacted creator has replied on Instagram.",
      parameters: { type: "object", properties: {} },
    },
  },
];

async function gateway(messages: GwMessage[]): Promise<GwMessage> {
  const key = process.env.BUTTERBASE_SERVICE_KEY;
  const app = process.env.BUTTERBASE_APP_ID ?? process.env.NEXT_PUBLIC_BUTTERBASE_APP_ID;
  if (!key) throw new Error("BUTTERBASE_SERVICE_KEY is not set");
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(app ? { "x-app-id": app } : {}),
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.4,
      max_tokens: 1200,
    }),
  });
  if (!res.ok) throw new Error(`gateway ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: Array<{ message?: GwMessage }> };
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error("gateway returned no message");
  return msg;
}

export async function runAgentChat(input: {
  messages: ChatTurn[];
  storeId?: string;
  brand?: string;
  /** Shortlist already shown earlier this conversation — lets follow-ups answer
   *  without re-running discovery. */
  shortlist?: InfluencerSuggestion[];
}): Promise<AgentChatResult> {
  const steps: string[] = [];
  let lastDiscovery: EnrichedDiscovery | undefined;
  let findCalls = 0;

  const convo: GwMessage[] = [
    { role: "system", content: systemPrompt(input.brand, input.shortlist) },
    ...input.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  let reply = "";
  for (let i = 0; i < MAX_STEPS; i++) {
    const msg = await gateway(convo);
    convo.push(msg);

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      reply = (msg.content ?? "").trim();
      break;
    }

    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        /* tolerate malformed args */
      }
      // Backstop: never run discovery more than once per turn.
      if (call.function.name === "find_influencers" && findCalls >= 1) {
        convo.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ note: "Already produced a shortlist this turn — answer from it." }),
        });
        continue;
      }
      if (call.function.name === "find_influencers") findCalls += 1;

      const forModel = await execTool(call.function.name, args, input, steps, (d) => {
        lastDiscovery = d;
      });
      convo.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(forModel),
      });
    }
  }

  if (!reply) reply = "Done.";

  return {
    reply,
    steps,
    influencers: lastDiscovery?.influencers,
    visuals: lastDiscovery?.visuals,
    memory: lastDiscovery?.memory,
  };
}

async function execTool(
  name: string,
  args: Record<string, unknown>,
  ctx: { storeId?: string; brand?: string },
  steps: string[],
  onDiscovery: (d: EnrichedDiscovery) => void,
): Promise<unknown> {
  try {
    if (name === "find_influencers") {
      const brandUrl = typeof args.brandUrl === "string" ? args.brandUrl : undefined;
      const query = typeof args.query === "string" ? args.query : undefined;
      steps.push(`🔎 Finding creators${brandUrl ? ` for ${brandUrl}` : ""}…`);
      const d = await discoverEnriched({ text: query ?? "", brandUrl, storeId: ctx.storeId });
      for (const s of d.steps) steps.push(s);
      onDiscovery(d);
      steps.push(`✅ ${d.influencers.length} creators ranked.`);
      return {
        count: d.influencers.length,
        creators: d.influencers.slice(0, 8).map((c) => ({
          handle: c.handle,
          platform: c.platform,
          followers: c.followers,
          score: c.score,
          rationale: c.rationale,
        })),
        note: d.reply,
      };
    }

    if (name === "send_dm") {
      const handle = String(args.handle ?? "").replace(/^@/, "").trim();
      if (!handle) return { ok: false, error: "no handle given" };
      const message = typeof args.message === "string" ? args.message : undefined;
      steps.push(`📨 DMing @${handle}…`);
      const r = await runOutreach({ handle, draft: message, brand: ctx.brand, storeId: ctx.storeId });
      // CRM: any creator we DM lands on the Influencers tab (best-effort).
      await persistOutreach(ctx.storeId, handle, r);
      steps.push(
        r.delivered
          ? `✅ DM delivered to @${handle}.`
          : r.needsConnection
            ? `⚠️ Instagram not connected — couldn't send to @${handle}.`
            : `⚠️ Couldn't deliver to @${handle}.`,
      );
      return {
        delivered: r.delivered,
        needsConnection: r.needsConnection ?? null,
        message: r.message,
        error: r.error ?? null,
      };
    }

    if (name === "check_replies") {
      steps.push("📥 Checking for replies…");
      const replies = await fetchReplies(ctx.storeId);
      return {
        count: replies.length,
        replies: replies.slice(0, 10).map((r) => ({ handle: r.handle, body: r.body, at: r.sentAt })),
      };
    }

    return { error: `unknown tool: ${name}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
