"use client";

import { Instagram, Music2, Youtube, AtSign } from "lucide-react";
import {
  NOTION_TEXT,
  NOTION_TEXT_MUTED,
  NOTION_TEXT_SUBTLE,
  NOTION_BORDER,
  CHART_PLATFORM_PALETTE,
} from "@/lib/colors";
import { formatFollowers } from "@/lib/utils";
import type { StoredInfluencer } from "@/lib/api";

/**
 * A Notion-style database table for the store's influencer candidates. Mirrors
 * Notion's table view: a bordered grid with a quiet header row, thin column
 * dividers, per-row hover, and inline "property" chips (platform select,
 * status select, score). Styled with the shared Notion tokens (lib/colors).
 */

interface InfluencerTableProps {
  influencers: StoredInfluencer[];
}

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

/** Notion "select" property chip — soft tinted pill. */
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

const STATUS_COLORS: Record<string, string> = {
  suggested: "#9b9a97",
  contacted: "#2383e2",
  replied: "#0f7b0f",
  declined: "#e03e3e",
};

function statusColor(status: string): string {
  return STATUS_COLORS[status.toLowerCase()] ?? "#9b9a97";
}

/** Cell wrapper with the Notion thin column divider + padding. */
function Cell({
  children,
  className = "",
  last = false,
}: {
  children: React.ReactNode;
  className?: string;
  last?: boolean;
}) {
  return (
    <td
      className={`px-3 py-2 align-middle ${className}`}
      style={{ borderRight: last ? undefined : `1px solid ${NOTION_BORDER}` }}
    >
      {children}
    </td>
  );
}

function HeaderCell({
  children,
  last = false,
  className = "",
}: {
  children: React.ReactNode;
  last?: boolean;
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-2 text-left text-xs font-medium ${className}`}
      style={{
        color: NOTION_TEXT_SUBTLE,
        borderRight: last ? undefined : `1px solid ${NOTION_BORDER}`,
      }}
    >
      {children}
    </th>
  );
}

function Row({ inf }: { inf: StoredInfluencer }) {
  const Icon = platformIcon(inf.platform);
  const pColor = platformColor(inf.platform);
  const scorePct =
    typeof inf.score === "number" ? Math.round(inf.score * 100) : null;

  return (
    <tr
      className="transition-colors hover:bg-[#f0efed]"
      style={{ borderTop: `1px solid ${NOTION_BORDER}` }}
    >
      {/* Influencer (primary "Name" column) */}
      <Cell>
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: `${pColor}1a`, color: pColor }}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <span
            className="truncate text-sm font-medium"
            style={{ color: NOTION_TEXT }}
          >
            @{inf.handle}
          </span>
        </div>
      </Cell>

      {/* Platform (select) */}
      <Cell>
        <SelectTag label={inf.platform} color={pColor} />
      </Cell>

      {/* Followers (number) */}
      <Cell className="text-right">
        <span
          className="text-sm tabular-nums"
          style={{ color: inf.followers != null ? NOTION_TEXT : NOTION_TEXT_MUTED }}
        >
          {inf.followers != null ? formatFollowers(inf.followers) : "—"}
        </span>
      </Cell>

      {/* Fit score (number, 0–100) */}
      <Cell className="text-right">
        {scorePct != null ? (
          <span
            className="inline-flex min-w-[2.25rem] justify-center rounded-[3px] px-1.5 py-0.5 text-xs font-medium tabular-nums"
            style={{ backgroundColor: "#f0f0ee", color: NOTION_TEXT }}
          >
            {scorePct}
          </span>
        ) : (
          <span className="text-sm" style={{ color: NOTION_TEXT_MUTED }}>
            —
          </span>
        )}
      </Cell>

      {/* Status (select) */}
      <Cell>
        <SelectTag label={inf.status} color={statusColor(inf.status)} />
      </Cell>

      {/* Rationale (text) */}
      <Cell last className="max-w-[26rem]">
        <span
          className="line-clamp-2 text-sm leading-snug"
          style={{ color: NOTION_TEXT_MUTED }}
        >
          {inf.rationale || "—"}
        </span>
      </Cell>
    </tr>
  );
}

export function InfluencerTable({ influencers }: InfluencerTableProps) {
  if (influencers.length === 0) {
    return (
      <div
        className="rounded-lg border px-6 py-16 text-center"
        style={{ borderColor: NOTION_BORDER }}
      >
        <p className="text-sm font-medium" style={{ color: NOTION_TEXT }}>
          No influencers yet
        </p>
        <p className="mt-1 text-sm" style={{ color: NOTION_TEXT_MUTED }}>
          Run a discovery in chat — creators pebble surfaces are saved here.
        </p>
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{ borderColor: NOTION_BORDER }}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ backgroundColor: "#fbfbfa" }}>
              <HeaderCell>Influencer</HeaderCell>
              <HeaderCell>Platform</HeaderCell>
              <HeaderCell className="text-right">Followers</HeaderCell>
              <HeaderCell className="text-right">Fit</HeaderCell>
              <HeaderCell>Status</HeaderCell>
              <HeaderCell last>Why they move your market</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {influencers.map((inf) => (
              <Row key={inf.id} inf={inf} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
