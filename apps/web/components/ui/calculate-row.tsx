"use client";

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { formatMoney } from "@storehausai/shared";
import { useStoreCurrency } from "@/contexts/StoreCurrencyContext";
import type { DataTableColumn } from "./data-table";

export type AggregationType =
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "count"
  | "count_unique"
  | "count_empty"
  | "count_not_empty";

const NUMBER_AGGS: AggregationType[] = ["sum", "avg", "min", "max", "count", "count_unique", "count_empty", "count_not_empty"];
const TEXT_AGGS: AggregationType[] = ["count", "count_unique", "count_empty", "count_not_empty"];

function getAvailableAggs(colType?: string): AggregationType[] {
  if (colType === "number" || colType === "currency") return NUMBER_AGGS;
  return TEXT_AGGS;
}

export function computeAggregation<T>(
  type: AggregationType,
  data: T[],
  colKey: string,
  getValue?: (row: T) => unknown,
): number | string | null {
  const getVal = getValue ?? ((row: T) => (row as Record<string, unknown>)[colKey]);
  const values = data.map(getVal);

  switch (type) {
    case "count": return data.length;
    case "count_empty": return values.filter((v) => v == null || v === "" || v === 0).length;
    case "count_not_empty": return values.filter((v) => v != null && v !== "" && v !== 0).length;
    case "count_unique": return new Set(values.filter((v) => v != null && v !== "").map(String)).size;
    case "sum": {
      const nums = values.filter((v): v is number => typeof v === "number");
      return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) : null;
    }
    case "avg": {
      const nums = values.filter((v): v is number => typeof v === "number");
      return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    }
    case "min": {
      const nums = values.filter((v): v is number => typeof v === "number");
      return nums.length > 0 ? Math.min(...nums) : null;
    }
    case "max": {
      const nums = values.filter((v): v is number => typeof v === "number");
      return nums.length > 0 ? Math.max(...nums) : null;
    }
  }
}

// Same z-index pattern as CellEditorPortal.
function AggPickerPortal({
  anchorEl,
  colType,
  selected,
  onSelect,
  onClose,
}: {
  anchorEl: HTMLElement;
  colType?: string;
  selected?: string | null;
  onSelect: (type: string | null) => void;
  onClose: () => void;
}) {
  const tc = useTranslations("common");
  const aggLabels: Record<AggregationType, string> = {
    sum: tc("column.sum"),
    avg: tc("column.average"),
    min: tc("column.min"),
    max: tc("column.max"),
    count: tc("column.countAll"),
    count_unique: tc("column.countUnique"),
    count_empty: tc("column.countEmpty"),
    count_not_empty: tc("column.countNotEmpty"),
  };
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const measure = () => setRect(anchorEl.getBoundingClientRect());
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [anchorEl]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  if (!rect) return null;

  const aggs = getAvailableAggs(colType);
  const bottom = window.innerHeight - rect.top;

  return createPortal(
    <>
      <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={onClose} />
      <div
        className="fixed animate-in fade-in-0 zoom-in-[0.98] duration-100"
        style={{ zIndex: 9999, bottom: bottom + 4, left: rect.left }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-surface-overlay rounded-lg border border-border shadow-lg py-1 w-[160px]">
          {selected && (
            <button
              onClick={() => { onSelect(null as any); onClose(); }}
              className="w-full px-3 py-1.5 text-left text-sm text-text-muted hover:bg-muted transition-colors"
            >
              {tc("column.none")}
            </button>
          )}
          {aggs.map((agg) => (
            <button
              key={agg}
              onClick={() => { onSelect(agg); onClose(); }}
              className={`w-full px-3 py-1.5 text-left text-sm hover:bg-muted transition-colors ${selected === agg ? "text-link font-medium" : "text-foreground"}`}
            >
              {aggLabels[agg]}
            </button>
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
}

// Duplicated from DataTable to stay in sync.
function getColumnStyle<T>(col: DataTableColumn<T>, widthOverride?: number): React.CSSProperties {
  if (widthOverride) {
    return { width: widthOverride, minWidth: widthOverride, flexShrink: 0, flexGrow: 0, overflow: "hidden" };
  }
  if (col.flex) {
    return { flex: 1, minWidth: col.minWidth ?? 120, overflow: "hidden" };
  }
  if (col.width) {
    return { width: col.width, minWidth: col.width, flexShrink: 0 };
  }
  return { minWidth: 80, flexShrink: 0 };
}

interface CalculateRowProps<T> {
  visibleColumns: DataTableColumn<T>[];
  columnWidths?: Record<string, number>;
  calculations: Record<string, { type: string; value: number | string | null }>;
  onCalculationChange: (colKey: string, type: string | null) => void;
  selectable?: boolean;
  columnConfig?: Record<string, { type?: string }>;
  extraHeaderSlot?: ReactNode;
}

export function CalculateRow<T>({
  visibleColumns,
  columnWidths,
  calculations,
  onCalculationChange,
  selectable,
  columnConfig,
  extraHeaderSlot,
}: CalculateRowProps<T>) {
  const tc = useTranslations("common");
  const storeCurrency = useStoreCurrency();
  const aggLabels: Record<AggregationType, string> = {
    sum: tc("column.sum"),
    avg: tc("column.average"),
    min: tc("column.min"),
    max: tc("column.max"),
    count: tc("column.countAll"),
    count_unique: tc("column.countUnique"),
    count_empty: tc("column.countEmpty"),
    count_not_empty: tc("column.countNotEmpty"),
  };
  const [pickerCol, setPickerCol] = useState<string | null>(null);
  const cellRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const closePicker = useCallback(() => setPickerCol(null), []);

  return (
    <div
      className="flex items-center px-2"
      style={{ gap: 0, height: 36 }}
    >
      {selectable && <div style={{ width: 36, flexShrink: 0 }} />}
      {visibleColumns.map((col) => {
        const calc = calculations[col.key];
        const colType = columnConfig?.[col.key]?.type;

        return (
          <div
            key={col.key}
            ref={(el) => { cellRefs.current[col.key] = el; }}
            data-col-key={col.key}
            style={getColumnStyle(col, columnWidths?.[col.key])}
            className="group/calccell h-full flex items-center justify-end px-2 overflow-visible"
          >
            <button
              type="button"
              onClick={() => setPickerCol(col.key)}
              className="text-sm rounded-md px-2 py-0.5 hover:bg-muted transition-colors max-w-full truncate"
            >
              {calc?.type ? (
                <span className="text-text-muted tabular-nums">
                  {aggLabels[calc.type as AggregationType] ?? calc.type}{" "}
                  <span className="text-foreground font-medium">
                    {calc.value != null ? (
                      typeof calc.value === "number"
                        ? colType === "currency" && !calc.type.startsWith("count")
                          ? formatMoney(calc.value, storeCurrency)
                          : calc.value.toLocaleString(undefined, { maximumFractionDigits: 2 })
                        : calc.value
                    ) : "–"}
                  </span>
                </span>
              ) : (
                <span className="text-text-disabled">{tc("column.calculate")}</span>
              )}
            </button>

            {pickerCol === col.key && cellRefs.current[col.key] && (
              <AggPickerPortal
                anchorEl={cellRefs.current[col.key]!}
                colType={colType}
                selected={calc?.type ?? null}
                onSelect={(type) => { onCalculationChange(col.key, type); }}
                onClose={closePicker}
              />
            )}
          </div>
        );
      })}
      {extraHeaderSlot && <div style={{ flexShrink: 0, width: 60 }} />}
    </div>
  );
}
