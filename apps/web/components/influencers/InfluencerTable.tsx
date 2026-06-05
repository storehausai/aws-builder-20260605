"use client";

import { useMemo, useState } from "react";
import { Instagram, Music2, Youtube, AtSign } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { InfluencerDetailSheet } from "@/components/influencers/InfluencerDetailSheet";
import {
  NOTION_TEXT,
  NOTION_TEXT_MUTED,
  CHART_PLATFORM_PALETTE,
} from "@/lib/colors";
import { formatFollowers } from "@/lib/utils";
import type { StoredInfluencer } from "@/lib/api";

/**
 * The store's influencer candidates rendered through storehaus's Notion-style
 * DataTable (vendored verbatim into components/ui/data-table). This module only
 * supplies the influencer column definitions + cell renderers; all table
 * behaviour (sort, search, column resize/reorder, hover) is the storehaus code.
 */

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

export function InfluencerTable({
  influencers,
  storeId,
}: {
  influencers: StoredInfluencer[];
  storeId: string;
}) {
  const [selected, setSelected] = useState<StoredInfluencer | null>(null);
  const [open, setOpen] = useState(false);

  const columns = useMemo<DataTableColumn<StoredInfluencer>[]>(
    () => [
      {
        key: "handle",
        header: "Influencer",
        flex: true,
        minWidth: 200,
        sortable: true,
        getValue: (r) => r.handle,
        render: (_v, r) => {
          const Icon = platformIcon(r.platform);
          const color = platformColor(r.platform);
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: `${color}1a`, color }}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span
                className="truncate text-sm font-medium"
                style={{ color: NOTION_TEXT }}
              >
                @{r.handle}
              </span>
            </div>
          );
        },
      },
      {
        key: "platform",
        header: "Platform",
        width: 130,
        sortable: true,
        getValue: (r) => r.platform,
        render: (_v, r) => (
          <SelectTag label={r.platform} color={platformColor(r.platform)} />
        ),
      },
      {
        key: "followers",
        header: "Followers",
        width: 130,
        align: "right",
        sortable: true,
        getValue: (r) => r.followers ?? -1,
        render: (_v, r) => (
          <span
            className="text-sm tabular-nums"
            style={{
              color: r.followers != null ? NOTION_TEXT : NOTION_TEXT_MUTED,
            }}
          >
            {r.followers != null ? formatFollowers(r.followers) : "—"}
          </span>
        ),
      },
      {
        key: "score",
        header: "Fit",
        width: 90,
        align: "right",
        sortable: true,
        getValue: (r) => r.score ?? -1,
        render: (_v, r) => {
          const pct =
            typeof r.score === "number" ? Math.round(r.score * 100) : null;
          if (pct == null)
            return (
              <span className="text-sm" style={{ color: NOTION_TEXT_MUTED }}>
                —
              </span>
            );
          return (
            <span
              className="inline-flex min-w-[2.25rem] justify-center rounded-[3px] px-1.5 py-0.5 text-xs font-medium tabular-nums"
              style={{ backgroundColor: "#f0f0ee", color: NOTION_TEXT }}
            >
              {pct}
            </span>
          );
        },
      },
      {
        key: "status",
        header: "Status",
        width: 140,
        sortable: true,
        getValue: (r) => r.status,
        render: (_v, r) => (
          <SelectTag label={r.status} color={statusColor(r.status)} />
        ),
      },
      {
        key: "rationale",
        header: "Why they move your market",
        flex: true,
        minWidth: 260,
        getValue: (r) => r.rationale,
        render: (_v, r) => (
          <span
            className="line-clamp-2 text-sm leading-snug"
            style={{ color: NOTION_TEXT_MUTED }}
          >
            {r.rationale || "—"}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <DataTable<StoredInfluencer>
        columns={columns}
        data={influencers}
        rowKey="id"
        defaultSort={{ key: "score", desc: true }}
        searchable={{ placeholder: "Search influencers…" }}
        onRowClick={(row) => {
          setSelected(row);
          setOpen(true);
        }}
      />
      <InfluencerDetailSheet
        influencer={selected}
        storeId={storeId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
