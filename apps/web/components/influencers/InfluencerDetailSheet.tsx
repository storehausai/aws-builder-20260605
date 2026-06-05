"use client";

import { useEffect, useState } from "react";
import {
  Instagram,
  Music2,
  Youtube,
  AtSign,
  Loader2,
  MessageSquare,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  NOTION_TEXT,
  NOTION_TEXT_MUTED,
  NOTION_BORDER,
  CHART_PLATFORM_PALETTE,
} from "@/lib/colors";
import { formatFollowers } from "@/lib/utils";
import {
  getInfluencerMessages,
  type StoredInfluencer,
  type OutreachMessage,
} from "@/lib/api";

function platformIcon(platform: string) {
  if (platform === "tiktok") return Music2;
  if (platform === "youtube") return Youtube;
  if (platform === "instagram") return Instagram;
  return AtSign;
}

function platformColor(platform: string): string {
  return (
    CHART_PLATFORM_PALETTE[platform as keyof typeof CHART_PLATFORM_PALETTE] ??
    "#6B7280"
  );
}

const STATUS_COLORS: Record<string, string> = {
  suggested: "#9b9a97",
  contacted: "#2383e2",
  replied: "#0f7b0f",
  declined: "#e03e3e",
};

function statusColor(status: string): string {
  return STATUS_COLORS[status.toLowerCase()] ?? "#9b9a97";
}

function SelectTag({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[3px] px-1.5 py-0.5 text-xs font-medium capitalize"
      style={{ backgroundColor: `${color}1a`, color }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      {label}
    </span>
  );
}

function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function MessageThread({
  messages,
  loading,
}: {
  messages: OutreachMessage[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2
          className="h-5 w-5 animate-spin"
          style={{ color: NOTION_TEXT_MUTED }}
        />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <MessageSquare
          className="mb-3 h-6 w-6"
          style={{ color: NOTION_TEXT_MUTED }}
        />
        <p className="text-sm font-medium" style={{ color: NOTION_TEXT }}>
          No messages yet
        </p>
        <p className="mt-1 text-sm" style={{ color: NOTION_TEXT_MUTED }}>
          Approve &amp; DM this creator from chat to start the conversation.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-5 py-5">
      {messages.map((m) => {
        const outbound = m.direction === "outbound";
        return (
          <div
            key={m.id}
            className={`flex flex-col ${outbound ? "items-end" : "items-start"}`}
          >
            <div
              className="max-w-[80%] rounded-2xl border px-3.5 py-2 text-sm leading-relaxed"
              style={
                outbound
                  ? {
                      backgroundColor: NOTION_TEXT,
                      color: "#ffffff",
                      borderColor: NOTION_TEXT,
                    }
                  : {
                      backgroundColor: "#f7f5f5",
                      color: NOTION_TEXT,
                      borderColor: NOTION_BORDER,
                    }
              }
            >
              {m.body}
            </div>
            <span
              className="mt-1 px-1 text-[11px]"
              style={{ color: NOTION_TEXT_MUTED }}
            >
              {outbound ? "You" : "Reply"} · {m.channel} · {formatTime(m.sentAt)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function InfluencerDetailSheet({
  influencer,
  storeId,
  open,
  onOpenChange,
}: {
  influencer: StoredInfluencer | null;
  storeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [messages, setMessages] = useState<OutreachMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const influencerId = influencer?.id ?? null;

  useEffect(() => {
    if (!open || !influencerId) return;
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    getInfluencerMessages(storeId, influencerId)
      .then((msgs) => {
        if (!cancelled) setMessages(msgs);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, influencerId, storeId]);

  const Icon = influencer ? platformIcon(influencer.platform) : AtSign;
  const color = influencer ? platformColor(influencer.platform) : "#6B7280";
  const scorePct =
    influencer && typeof influencer.score === "number"
      ? Math.round(influencer.score * 100)
      : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        size="lg"
        padding="none"
        className="flex flex-col"
      >
        {influencer && (
          <>
            {/* Header */}
            <div
              className="flex-shrink-0 border-b px-5 pb-4 pt-5"
              style={{ borderColor: NOTION_BORDER }}
            >
              <div className="flex items-center gap-3 pr-8">
                <span
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${color}1a`, color }}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <SheetTitle
                    className="truncate text-base"
                    style={{ color: NOTION_TEXT }}
                  >
                    @{influencer.handle}
                  </SheetTitle>
                  <p
                    className="mt-0.5 text-xs"
                    style={{ color: NOTION_TEXT_MUTED }}
                  >
                    {influencer.platform}
                    {influencer.followers != null &&
                      ` · ${formatFollowers(influencer.followers)} followers`}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <SelectTag
                  label={influencer.status}
                  color={statusColor(influencer.status)}
                />
                {scorePct != null && (
                  <span
                    className="inline-flex items-center rounded-[3px] px-1.5 py-0.5 text-xs font-medium tabular-nums"
                    style={{ backgroundColor: "#f0f0ee", color: NOTION_TEXT }}
                  >
                    {scorePct} fit
                  </span>
                )}
              </div>

              {influencer.rationale && (
                <p
                  className="mt-3 text-sm leading-relaxed"
                  style={{ color: NOTION_TEXT_MUTED }}
                >
                  {influencer.rationale}
                </p>
              )}
            </div>

            {/* Conversation */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <p
                className="px-5 pt-4 text-xs font-medium uppercase tracking-wider"
                style={{ color: NOTION_TEXT_MUTED }}
              >
                Message history
              </p>
              <MessageThread messages={messages} loading={loading} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
