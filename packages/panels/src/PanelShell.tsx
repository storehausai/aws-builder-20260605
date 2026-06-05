import type { ReactNode } from "react";

export interface PanelShellProps {
  title: string;
  children?: ReactNode;
}

/**
 * The outer frame every generated panel composes. Skeleton — the real design
 * system (KpiRow, RankChart, CreatorCard, DataTable, …) grows alongside this.
 * The AI imports these from "@pebble/panels" inside the sandboxed runtime.
 */
export function PanelShell({ title, children }: PanelShellProps) {
  return (
    <div className="pebble-panel">
      <h1 className="pebble-panel__title">{title}</h1>
      <div className="pebble-panel__body">{children}</div>
    </div>
  );
}
