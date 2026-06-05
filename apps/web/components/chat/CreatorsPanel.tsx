"use client";

import { useState } from "react";
import { Instagram, Music2, Send, Check, Loader2 } from "lucide-react";
import { NOTION_TEXT, NOTION_TEXT_MUTED, CHART_PLATFORM_PALETTE } from "@/lib/colors";
import { formatFollowers } from "@/lib/utils";
import { KpiStrip, type Kpi } from "./KpiStrip";
import { Button } from "@/components/ui/button";
import { outreach, type InfluencerSuggestion, type OutreachResult } from "@/lib/api";

export interface CreatorsArtifact {
  title: string;
  brand?: string;
  storeId?: string;
  influencers: InfluencerSuggestion[];
}

interface CreatorsPanelProps {
  artifact: CreatorsArtifact;
  /** Surfaces the composed DM (or connect-IG ask) back into the chat. */
  onOutreach?: (handle: string, result: OutreachResult) => void;
}

function platformIcon(platform: string) {
  if (platform === "tiktok") return Music2;
  return Instagram;
}

function PlatformDot({ platform }: { platform: string }) {
  const color =
    CHART_PLATFORM_PALETTE[platform as keyof typeof CHART_PLATFORM_PALETTE] ??
    "#6B7280";
  return (
    <span
      className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
      style={{ backgroundColor: color }}
      aria-hidden
    />
  );
}

function CreatorCard({
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
  const Icon = platformIcon(c.platform);

  async function approveAndDm() {
    setState("sending");
    try {
      const result = await outreach({ handle: c.handle, brand, storeId });
      onOutreach?.(c.handle, result);
      setState("done");
    } catch {
      setState("idle");
    }
  }

  const scorePct =
    typeof c.score === "number" ? Math.round(c.score * 100) : null;

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3.5 transition-shadow hover:shadow-sm">
      <div className="flex items-start gap-2">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-muted text-text-secondary">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="flex items-center gap-1.5 truncate text-sm font-semibold"
            style={{ color: NOTION_TEXT }}
          >
            <PlatformDot platform={c.platform} />
            <span className="truncate">@{c.handle}</span>
          </div>
          <div className="mt-0.5 text-xs" style={{ color: NOTION_TEXT_MUTED }}>
            {c.platform}
            {c.followers != null && ` · ${formatFollowers(c.followers)} followers`}
          </div>
        </div>
        {scorePct != null && (
          <span className="flex-shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground tabular-nums">
            {scorePct}
          </span>
        )}
      </div>

      <p
        className="line-clamp-3 text-xs leading-relaxed"
        style={{ color: NOTION_TEXT_MUTED }}
      >
        {c.rationale}
      </p>

      <Button
        variant={state === "done" ? "secondary" : "primary"}
        size="sm"
        shape="lg"
        className="w-full"
        disabled={state !== "idle"}
        onClick={approveAndDm}
      >
        {state === "sending" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Composing…
          </>
        ) : state === "done" ? (
          <>
            <Check className="h-4 w-4" /> Outreach drafted
          </>
        ) : (
          <>
            <Send className="h-4 w-4" /> Approve &amp; DM
          </>
        )}
      </Button>
    </div>
  );
}

export function CreatorsPanel({ artifact, onOutreach }: CreatorsPanelProps) {
  const { title, brand, storeId, influencers } = artifact;

  const kpis: Kpi[] = [
    { label: "Creators found", value: influencers.length },
    {
      label: "Total reach",
      value: influencers.reduce((sum, c) => sum + (c.followers ?? 0), 0),
    },
    {
      label: "Platforms",
      value: new Set(influencers.map((c) => c.platform)).size,
    },
    {
      label: "Avg. fit",
      value: influencers.length
        ? `${Math.round(
            (influencers.reduce((s, c) => s + (c.score ?? 0), 0) /
              influencers.length) *
              100,
          )}`
        : "—",
    },
  ];

  return (
    <div className="h-full overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header>
          <h2 className="text-base font-semibold" style={{ color: NOTION_TEXT }}>
            {title}
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: NOTION_TEXT_MUTED }}>
            {influencers.length} creator{influencers.length === 1 ? "" : "s"}{" "}
            ranked by market-mover fit
            {brand ? ` · ${brand}` : ""}
          </p>
        </header>

        <KpiStrip kpis={kpis} />

        {influencers.length === 0 ? (
          <p
            className="py-8 text-center text-sm"
            style={{ color: NOTION_TEXT_MUTED }}
          >
            No creators to show yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {influencers.map((c) => (
              <CreatorCard
                key={`${c.platform}:${c.handle}`}
                c={c}
                brand={brand}
                storeId={storeId}
                onOutreach={onOutreach}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
