"use client";

import { NOTION_TEXT, NOTION_TEXT_MUTED } from "@/lib/colors";

export interface Kpi {
  label: string;
  value: number | string;
}

function fmt(v: number | string): string {
  if (typeof v === "string") return v;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return v.toLocaleString();
}

export function KpiStrip({ kpis }: { kpis: Kpi[] }) {
  if (kpis.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {kpis.map((k) => (
        <div
          key={k.label}
          className="rounded-lg border border-border bg-card px-3 py-2.5"
        >
          <div className="text-lg font-semibold" style={{ color: NOTION_TEXT }}>
            {fmt(k.value)}
          </div>
          <div className="mt-0.5 text-xs" style={{ color: NOTION_TEXT_MUTED }}>
            {k.label}
          </div>
        </div>
      ))}
    </div>
  );
}
