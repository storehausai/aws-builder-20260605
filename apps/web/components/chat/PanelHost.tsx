"use client";

// The always-present right-hand panel of the chat workspace. When discovery
// returns creators, that decision arrives here (lifted out of ChatView via
// onPanelArtifact -> ChatWorkspace) and the agent builds a LIVE DASHBOARD: an
// AI-generated, self-contained HTML document (Claude-Artifacts model) rendered
// in an origin-isolated <iframe srcDoc sandbox="allow-scripts">.
//
// Because that iframe is sandboxed (no same-origin), it can't trigger app
// actions — so the Approve & DM affordance lives as a slim strip beneath it,
// wired to the real outreach() call. The artifact is the star; the chat and the
// action strip are the secondary columns.
import { useEffect, useRef, useState } from "react";
import { Instagram, Music2, Send, Check, Loader2, Sparkles } from "lucide-react";
import {
  generatePanel,
  outreach,
  type InfluencerSuggestion,
  type OutreachResult,
} from "@/lib/api";
import { formatFollowers } from "@/lib/utils";
import type { CreatorsArtifact } from "@/components/chat/CreatorsPanel";

export interface PanelArtifact extends CreatorsArtifact {
  viz: "creators";
}

function signature(list: InfluencerSuggestion[]): string {
  return list.map((c) => `${c.platform}:${c.handle}`).join("|");
}

export function PanelHost({
  artifact,
  onOutreach,
}: {
  artifact: PanelArtifact | null;
  onOutreach?: (handle: string, result: OutreachResult) => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  const influencers = artifact?.influencers ?? [];
  const sig = signature(influencers);

  useEffect(() => {
    if (!artifact || influencers.length === 0) {
      setHtml(null);
      setSource(null);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    generatePanel({ brand: artifact.brand, influencers })
      .then((res) => {
        if (id !== reqId.current) return; // a newer artifact superseded this one
        setHtml(res.html);
        setSource(res.source);
      })
      .catch(() => {
        if (id === reqId.current) setHtml(null);
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // No artifact yet: a calm, content-first empty state.
  if (!artifact) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background px-6">
        <div className="max-w-sm text-center">
          <p className="text-sm font-medium text-foreground">Your workspace</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Ask in the chat — when I pull up creators who can move your market, I
            build you a live dashboard here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* The AI artifact */}
      <div className="relative min-h-0 flex-1">
        {html ? (
          <iframe
            // Untrusted generated markup: isolate it. allow-scripts WITHOUT
            // allow-same-origin lets it run Chart.js but denies access to this
            // app's origin, cookies, or storage.
            srcDoc={html}
            sandbox="allow-scripts"
            title={artifact.title}
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
            <Sparkles
              className={`h-5 w-5 text-muted-foreground ${loading ? "animate-pulse" : ""}`}
            />
            <p className="text-sm font-medium text-foreground">
              {loading ? "Building your dashboard…" : "Preparing dashboard…"}
            </p>
            <p className="max-w-xs text-[13px] leading-relaxed text-muted-foreground">
              The agent is composing a live analytics panel from these results —
              grounded only on the real numbers.
            </p>
          </div>
        )}
        {source && html && (
          <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white/90">
            <Sparkles className="h-2.5 w-2.5" />
            {source === "fallback" ? "Built from your data" : source}
          </div>
        )}
      </div>

      {/* Approve & DM — the action the sandboxed artifact can't perform itself. */}
      <OutreachStrip
        influencers={influencers}
        brand={artifact.brand}
        storeId={artifact.storeId}
        onOutreach={onOutreach}
      />
    </div>
  );
}

function OutreachStrip({
  influencers,
  brand,
  storeId,
  onOutreach,
}: {
  influencers: InfluencerSuggestion[];
  brand?: string;
  storeId?: string;
  onOutreach?: (handle: string, result: OutreachResult) => void;
}) {
  return (
    <div className="shrink-0 border-t border-border bg-background/80 px-3 py-2">
      <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Approve &amp; DM
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {influencers.map((c) => (
          <CreatorChip
            key={`${c.platform}:${c.handle}`}
            c={c}
            brand={brand}
            storeId={storeId}
            onOutreach={onOutreach}
          />
        ))}
      </div>
    </div>
  );
}

function CreatorChip({
  c,
  brand,
  storeId,
  onOutreach,
}: {
  c: InfluencerSuggestion;
  brand?: string;
  storeId?: string;
  onOutreach?: (handle: string, result: OutreachResult) => void;
}) {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const Icon = c.platform === "tiktok" ? Music2 : Instagram;

  async function approveAndDm() {
    setState("sending");
    try {
      const result = await outreach({ handle: c.handle, brand, storeId });
      onOutreach?.(c.handle, result);
      setState(result.delivered ? "done" : "idle");
    } catch {
      setState("idle");
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <div className="min-w-0">
        <div className="truncate text-[12.5px] font-medium text-foreground">@{c.handle}</div>
        <div className="text-[10.5px] text-muted-foreground">{formatFollowers(c.followers)}</div>
      </div>
      <button
        type="button"
        onClick={approveAndDm}
        disabled={state !== "idle"}
        className="ml-1 flex h-7 items-center gap-1 rounded-md bg-foreground px-2 text-[11.5px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        aria-label={`Approve and DM @${c.handle}`}
      >
        {state === "sending" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : state === "done" ? (
          <Check className="h-3 w-3" />
        ) : (
          <Send className="h-3 w-3" />
        )}
        {state === "done" ? "Sent" : "DM"}
      </button>
    </div>
  );
}
