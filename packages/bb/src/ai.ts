import type { ChatMessage, ChatOptions } from "@butterbase/sdk";
import type { Bb } from "./client.js";
import { unwrap } from "./client.js";

/**
 * The Butterbase AI gateway — the app's ONLY LLM path.
 * Unified, OpenAI-compatible access to Claude / GPT / Gemini via `provider/model`.
 */
export const DEFAULT_MODEL = process.env.BB_MODEL ?? "anthropic/claude-sonnet-4.6";
/** A fast/cheap model for HTML panel generation + short closings. */
export const FAST_MODEL = process.env.BB_FAST_MODEL ?? "google/gemini-2.5-flash";

export async function chat(bb: Bb, messages: ChatMessage[], options: ChatOptions = {}) {
  const res = await bb.ai.chat(messages, { model: DEFAULT_MODEL, ...options });
  return unwrap(res);
}

/** system + user → assistant text. The workhorse for prose + structured asks. */
export async function chatText(
  bb: Bb,
  system: string,
  user: string,
  options: ChatOptions = {},
): Promise<string> {
  const completion = await chat(
    bb,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    options,
  );
  return completion.choices?.[0]?.message?.content ?? "";
}
