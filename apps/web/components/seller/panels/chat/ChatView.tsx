"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Sparkles, Brain } from "lucide-react";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { SuggestionChips } from "./SuggestionChips";
import { StepTimeline } from "./StepTimeline";
import { ResearchCanvas } from "@/components/chat/ResearchCanvas";
import { chatStore, type StoredMessage } from "@/lib/chat-store";
import { chat, getReplies, type ChatTurn, type DiscoveryResult, type OutreachResult } from "@/lib/api";

/** The agent's recalled XTrace memory, shown before it starts working. */
function MemoryNote({ text }: { text: string }) {
  const clean = text.replace(/^#+\s*/gm, "").replace(/\n{2,}/g, "\n").trim();
  if (!clean) return null;
  return (
    <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 px-3.5 py-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
        <Brain className="h-3 w-3" /> From memory
      </div>
      <p className="line-clamp-4 whitespace-pre-line text-[13px] leading-snug text-amber-900/80">{clean}</p>
    </div>
  );
}

const STEP_REVEAL_MS = 600;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function ChatView({
  chatId,
  storeId,
  brand,
  seed,
  onOutreach,
}: {
  chatId: string;
  storeId: string;
  brand?: string;
  seed?: string | null;
  onOutreach?: (handle: string, result: OutreachResult) => void;
}) {
  const [messages, setMessages] = useState<StoredMessage[]>(() => chatStore.messages(chatId));
  const [liveSteps, setLiveSteps] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<ChatInputHandle>(null);
  const seededRef = useRef(false);
  const lastReplyAt = useRef<string>(new Date().toISOString());

  const persist = useCallback(
    (msgs: StoredMessage[]) => {
      setMessages(msgs);
      chatStore.setMessages(chatId, msgs);
    },
    [chatId],
  );

  // Reload this chat's messages on open.
  useEffect(() => {
    setMessages(chatStore.messages(chatId));
  }, [chatId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, liveSteps]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const now = new Date().toISOString();
      const userMsg: StoredMessage = { id: `u_${now}`, role: "user", content: trimmed, createdAt: now };
      const next = [...chatStore.messages(chatId), userMsg];
      persist(next);
      chatStore.touch(chatId, trimmed.slice(0, 48));
      setLoading(true);
      setLiveSteps(["Thinking…"]);

      // Replay the conversation so the agent has context; IT decides which tools
      // to run (find creators / DM / check replies) — no fixed re-discovery.
      const history: ChatTurn[] = next
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      // The most recent shortlist, so the agent answers follow-ups from it
      // instead of re-running discovery.
      const shortlist = [...next].reverse().find((m) => m.influencers && m.influencers.length)?.influencers;

      let result: DiscoveryResult;
      try {
        result = await chat(history, storeId, brand, shortlist);
      } catch (e) {
        setLiveSteps(null);
        setLoading(false);
        persist([
          ...next,
          { id: `a_${Date.now()}`, role: "assistant", content: `Sorry — ${(e as Error).message}`, createdAt: new Date().toISOString() },
        ]);
        return;
      }

      // Reveal any tool-work steps one at a time. A plain chat turn has none —
      // it just shows the reply (no more "mapping the market…" on every message).
      const steps = result.steps ?? [];
      for (let i = 0; i < steps.length; i++) {
        setLiveSteps(steps.slice(0, i + 1));
        await sleep(STEP_REVEAL_MS);
      }

      const assistant: StoredMessage = {
        id: `a_${Date.now()}`,
        role: "assistant",
        content: result.reply,
        steps: steps.length ? steps : undefined,
        influencers: result.influencers,
        visuals: result.visuals,
        memory: result.memory,
        createdAt: new Date().toISOString(),
      };
      persist([...next, assistant]);
      setLiveSteps(null);
      setLoading(false);
    },
    [chatId, loading, persist, storeId, brand],
  );

  // Auto-send the seeded prompt (from a dashboard example chip) once.
  useEffect(() => {
    if (seed && !seededRef.current && chatStore.messages(chatId).length === 0) {
      seededRef.current = true;
      void send(seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, chatId]);

  // Poll for influencer replies and surface them in the chat.
  useEffect(() => {
    if (!storeId) return;
    let alive = true;
    const tick = async () => {
      const replies = await getReplies(storeId, lastReplyAt.current);
      if (!alive || replies.length === 0) return;
      lastReplyAt.current = new Date().toISOString();
      const cur = chatStore.messages(chatId);
      const lines = replies.map((r) => ({
        id: `r_${r.id}`,
        role: "assistant" as const,
        content: `📩 **@${r.handle}** replied:\n\n> ${r.body}`,
        createdAt: r.sentAt,
      }));
      persist([...cur, ...lines]);
    };
    const h = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, [storeId, chatId, persist]);

  const empty = messages.length === 0 && !loading;

  return (
    <div className="flex h-full flex-col bg-background">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-5 py-8">
          {empty ? (
            <div className="flex flex-col items-center justify-center pt-16 text-center">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-surface-raised text-foreground">
                <Sparkles className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">How can I help with {brand ?? "your brand"}?</h2>
              <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
                Ask me to find creators who move your market, or pick one to start.
              </p>
              <div className="mt-6 w-full">
                <SuggestionChips onAction={(p) => void send(p)} />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {messages.map((m) => (
                <Message key={m.id} m={m} storeId={storeId} brand={brand} onOutreach={onOutreach} />
              ))}
              {loading && liveSteps != null && liveSteps.length > 0 && <StepTimeline steps={liveSteps} />}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-background">
        <div className="mx-auto w-full max-w-2xl">
          <ChatInput
            ref={inputRef}
            onSend={(t) => void send(t)}
            isLoading={loading}
            placeholder={`Message pebble about ${brand ?? "your brand"}…`}
          />
        </div>
      </div>
    </div>
  );
}

function Message({
  m,
  storeId,
  brand,
  onOutreach,
}: {
  m: StoredMessage;
  storeId: string;
  brand?: string;
  onOutreach?: (handle: string, result: OutreachResult) => void;
}) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-foreground px-4 py-2.5 text-sm text-background">
          {m.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      {m.memory && <MemoryNote text={m.memory} />}
      {m.steps && m.steps.length > 0 && <StepTimeline steps={m.steps} done />}
      {m.visuals && (
        <ResearchCanvas visuals={m.visuals} storeId={storeId} brand={brand} onOutreach={onOutreach} />
      )}
      <div className="prose prose-sm max-w-none text-foreground prose-p:my-1.5 prose-strong:text-foreground">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
      </div>
    </div>
  );
}

