"use client";

import { useState, useMemo, useCallback, useRef, useEffect, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronUp,
  ChevronDown,
  Search,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { SelectionActionBar } from "@/components/ui/selection-action-bar";
import { MenuItem } from "@/components/ui/menu-item";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { CalculateRow } from "./calculate-row";
import {
  DndContext,
  closestCenter,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";

export interface HeaderRenderContext {
  sorted: "asc" | "desc" | false;
  onSort: (direction: "asc" | "desc") => void;
}

export interface DataTableColumn<T> {
  key: string;
  header: string;
  width?: number;
  flex?: boolean;
  minWidth?: number;
  align?: "left" | "right";
  sortable?: boolean;
  sortFn?: (a: T, b: T) => number;
  getValue?: (row: T) => unknown;
  render?: (value: unknown, row: T) => ReactNode;
  headerRender?: (ctx: HeaderRenderContext) => ReactNode;
  editable?: boolean | ((row: T) => boolean);
  // Set false when the column render manages its own hover zones.
  cellHover?: boolean;
}

export interface DataTableTab<T> {
  key: string;
  label: string;
  count?: number;
  filter: (row: T) => boolean;
}

export interface BulkAction {
  label: string;
  onClick: (selectedIds: Set<string>) => void | Promise<void>;
  variant?: "default" | "danger";
  icon?: ReactNode;
  dataTest?: string;
}

export interface ServerModeLoadMore {
  hasMore: boolean;
  fetchNextPage: () => void;
  isLoadingMore: boolean;
  total: number;
  pageSize: number;
}

export interface ServerModeConfig {
  loadMore: ServerModeLoadMore;
  onSearchChange: (query: string) => void;
  tabCounts: Record<string, number>;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: keyof T & string;
  tabs?: DataTableTab<T>[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  defaultSort?: { key: string; desc: boolean };
  searchable?: boolean | { placeholder?: string; fn?: (row: T, query: string) => boolean };
  selectable?: boolean;
  onRowClick?: (row: T, e: React.MouseEvent) => void;
  onSelectionChange?: (selected: Set<string>) => void;
  externalFilter?: (row: T) => boolean;
  pageSize?: number;
  bulkActions?: BulkAction[];
  isLoading?: boolean;
  // Server-side pagination/search/tab — skips client-side filtering.
  serverMode?: ServerModeConfig;
  extraHeaderSlot?: ReactNode;
  toolbarSlot?: ReactNode;
  hiddenColumns?: Set<string>;
  columnWidths?: Record<string, number>;
  onColumnResize?: (key: string, width: number) => void;
  onCellClick?: (rowId: string, colKey: string, cellEl: HTMLElement, e: React.MouseEvent) => void;
  columnOrder?: string[];
  onColumnReorder?: (order: string[]) => void;
  showCalculateRow?: boolean;
  calculations?: Record<string, { type: string; value: number | string | null }>;
  onCalculationChange?: (colKey: string, type: string | null) => void;
  columnConfig?: Record<string, { type?: string }>;
}

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

function defaultSearchFn<T>(row: T, query: string): boolean {
  const q = query.toLowerCase();
  return Object.values(row as Record<string, unknown>).some((v) => {
    if (v == null) return false;
    return String(v).toLowerCase().includes(q);
  });
}

function defaultSortFn<T>(
  col: DataTableColumn<T>
): (a: T, b: T) => number {
  return (a, b) => {
    const getVal = col.getValue ?? ((row: T) => (row as Record<string, unknown>)[col.key]);
    const va = getVal(a);
    const vb = getVal(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "number" && typeof vb === "number") return va - vb;
    return String(va).localeCompare(String(vb));
  };
}

function TabBar<T>({
  tabs,
  activeTab,
  tabCounts,
  onTabChange,
}: {
  tabs: DataTableTab<T>[];
  activeTab: string;
  tabCounts: Record<string, number>;
  onTabChange: (key: string) => void;
}) {
  return (
    <div className="relative">
      <div className="flex @[640px]:hidden">
        <TabBarMobile
          tabs={tabs}
          activeTab={activeTab}
          tabCounts={tabCounts}
          onTabChange={onTabChange}
        />
      </div>
      <div className="relative hidden @[640px]:flex">
        <TabBarDesktop
          tabs={tabs}
          activeTab={activeTab}
          tabCounts={tabCounts}
          onTabChange={onTabChange}
        />
      </div>
    </div>
  );
}

function TabBarDesktop<T>({
  tabs,
  activeTab,
  tabCounts,
  onTabChange,
}: {
  tabs: DataTableTab<T>[];
  activeTab: string;
  tabCounts: Record<string, number>;
  onTabChange: (key: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const activeBtn = container.querySelector<HTMLButtonElement>(
      `[data-tab-key="${activeTab}"]`
    );
    if (!activeBtn) return;
    setIndicator({
      left: activeBtn.offsetLeft,
      width: activeBtn.offsetWidth,
    });
    setReady(true);
  }, [activeTab, tabs]);

  return (
    <div ref={containerRef} className="relative flex">
      {ready && (
        <span
          className="absolute inset-y-1 rounded-full bg-muted transition-all duration-200 ease-out"
          style={{ left: indicator.left, width: indicator.width }}
        />
      )}
      {tabs.map((tab) => {
        const count = tabCounts[tab.key] ?? tab.count ?? 0;
        const active = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            data-tab-key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={`relative px-3 py-2 text-sm transition-colors ${
              active
                ? "font-medium text-foreground"
                : "text-text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
            {count > 0 && (
              <span className="ml-1 text-sm text-text-disabled">
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function TabBarMobile<T>({
  tabs,
  activeTab,
  tabCounts,
  onTabChange,
}: {
  tabs: DataTableTab<T>[];
  activeTab: string;
  tabCounts: Record<string, number>;
  onTabChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeTabConfig = tabs.find((t) => t.key === activeTab);
  const activeLabel = activeTabConfig?.label ?? "";
  const activeCount =
    tabCounts[activeTab] ?? activeTabConfig?.count ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 py-1 text-sm font-medium text-foreground"
        >
          <span>{activeLabel}</span>
          {activeCount > 0 && (
            <span className="ml-0.5 text-text-disabled font-normal">
              {activeCount}
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 ml-0.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1">
        {tabs.map((tab) => {
          const count = tabCounts[tab.key] ?? tab.count ?? 0;
          const active = activeTab === tab.key;
          return (
            <MenuItem
              key={tab.key}
              active={active}
              onClick={() => {
                onTabChange(tab.key);
                setOpen(false);
              }}
            >
              <span className="flex-1 text-left">{tab.label}</span>
              <span className="text-text-disabled text-sm">{count}</span>
            </MenuItem>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function SortableHeaderCell({
  id,
  children,
  style,
  className,
  disabled,
  isDragOverlay,
}: {
  id: string;
  children: ReactNode;
  style?: React.CSSProperties;
  className?: string;
  disabled?: boolean;
  isDragOverlay?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: disabled || isDragOverlay });

  const combinedStyle: React.CSSProperties = isDragOverlay
    ? { ...style }
    : {
        ...style,
        transform: transform
          ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
          : undefined,
        transition,
      };

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      data-col-key={id}
      style={combinedStyle}
      className={`${className ?? ""} ${
        isDragging
          ? "opacity-30"
          : isDragOverlay
            ? "shadow-lg ring-1 ring-ring/20 bg-surface-overlay"
            : ""
      }`}
      {...(isDragOverlay ? {} : { ...attributes, ...listeners })}
    >
      {children}
    </div>
  );
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  tabs,
  activeTab: activeTabProp,
  onTabChange,
  defaultSort,
  searchable,
  selectable = false,
  onRowClick,
  onSelectionChange,
  externalFilter,
  pageSize = 0,
  bulkActions,
  isLoading = false,
  extraHeaderSlot,
  toolbarSlot,
  hiddenColumns,
  columnWidths,
  onColumnResize,
  onCellClick,
  columnOrder,
  onColumnReorder,
  showCalculateRow,
  calculations,
  onCalculationChange,
  columnConfig,
  serverMode,
}: DataTableProps<T>) {
  const tc = useTranslations("common");
  // Refs for 60fps drag without re-renders.
  const dragRef = useRef<{ colKey: string; startX: number; startW: number } | null>(null);
  const headerRowRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = e.clientX - drag.startX;
      const newW = Math.max(50, drag.startW + delta);
      const root = headerRowRef.current?.parentElement;
      if (!root) return;
      root.querySelectorAll<HTMLElement>(`[data-col-key="${drag.colKey}"]`).forEach((el) => {
        el.style.width = `${newW}px`;
        el.style.minWidth = `${newW}px`;
        el.style.flex = "none";
      });
    };
    const onMouseUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      const cell = headerRowRef.current?.querySelector<HTMLElement>(`[data-col-key="${drag.colKey}"]`);
      if (cell) {
        onColumnResize?.(drag.colKey, cell.offsetWidth);
      }
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [onColumnResize]);

  const startResize = useCallback((colKey: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const cell = headerRowRef.current?.querySelector<HTMLElement>(`[data-col-key="${colKey}"]`);
    if (!cell) return;
    dragRef.current = { colKey, startX: e.clientX, startW: cell.offsetWidth };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  // Notion-style infinite scroll: load next page when sentinel enters viewport.
  const loadMoreFn = serverMode?.loadMore.fetchNextPage;
  const loadMoreHasMore = serverMode?.loadMore.hasMore ?? false;
  const loadMoreLoading = serverMode?.loadMore.isLoadingMore ?? false;
  useEffect(() => {
    if (!loadMoreFn || !loadMoreHasMore || loadMoreLoading) return;
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            loadMoreFn();
            break;
          }
        }
      },
      { rootMargin: "200px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMoreFn, loadMoreHasMore, loadMoreLoading]);

  const [internalActiveTab, setInternalActiveTab] = useState<string>(
    activeTabProp ?? (tabs?.[0]?.key ?? "")
  );
  const [sortKey, setSortKey] = useState<string>(defaultSort?.key ?? "");
  const [sortDesc, setSortDesc] = useState<boolean>(defaultSort?.desc ?? false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);

  const activeTab = activeTabProp !== undefined ? activeTabProp : internalActiveTab;

  const visibleColumns = useMemo(() => {
    let cols = columns;
    if (hiddenColumns && hiddenColumns.size > 0) {
      cols = cols.filter((c) => !hiddenColumns.has(c.key));
    }
    if (columnOrder && columnOrder.length > 0) {
      // First column pinned — never reordered.
      const first = cols[0];
      const rest = cols.slice(1);
      const orderMap = new Map(columnOrder.map((k, i) => [k, i]));
      rest.sort((a, b) => {
        const ia = orderMap.get(a.key) ?? 999;
        const ib = orderMap.get(b.key) ?? 999;
        return ia - ib;
      });
      cols = [first, ...rest];
    }
    return cols;
  }, [columns, hiddenColumns, columnOrder]);

  // Static min-width prevents table width shifting when hover elements appear.
  const tableMinWidth = useMemo(() => {
    let total = 16; // row px-2 (8px each side)
    if (selectable) total += 36;
    for (const col of visibleColumns) {
      const override = columnWidths?.[col.key];
      if (override) {
        total += override;
      } else if (col.flex) {
        total += col.minWidth ?? 120;
      } else if (col.width) {
        total += col.width;
      } else {
        total += 80;
      }
    }
    if (extraHeaderSlot) total += 60;
    return total;
  }, [visibleColumns, columnWidths, selectable, extraHeaderSlot]);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const [activeHeaderId, setActiveHeaderId] = useState<string | null>(null);

  const handleHeaderDragStart = useCallback((event: DragStartEvent) => {
    setActiveHeaderId(event.active.id as string);
  }, []);

  const handleHeaderDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveHeaderId(null);
      const { active, over } = event;
      if (!over || active.id === over.id || !onColumnReorder) return;
      const firstKey = visibleColumns[0]?.key;
      if (active.id === firstKey || over.id === firstKey) return;
      const restKeys = visibleColumns.slice(1).map((c) => c.key);
      const oldIndex = restKeys.indexOf(active.id as string);
      const newIndex = restKeys.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;
      onColumnReorder(arrayMove(restKeys, oldIndex, newIndex));
    },
    [visibleColumns, onColumnReorder]
  );

  const handleHeaderDragCancel = useCallback(() => setActiveHeaderId(null), []);

  const isSearchable = !!searchable;
  const searchFn =
    typeof searchable === "object" && searchable.fn
      ? searchable.fn
      : defaultSearchFn<T>;
  const searchPlaceholder =
    typeof searchable === "object" && "placeholder" in searchable
      ? searchable.placeholder
      : "Search...";

  const afterExternal = useMemo(() => {
    if (!externalFilter) return data;
    return data.filter(externalFilter);
  }, [data, externalFilter]);

  const tabCounts = useMemo(() => {
    if (serverMode) return serverMode.tabCounts;
    if (!tabs) return {};
    return Object.fromEntries(
      tabs.map((tab) => [tab.key, afterExternal.filter(tab.filter).length])
    );
  }, [tabs, afterExternal, serverMode]);

  const afterTab = useMemo(() => {
    if (serverMode) return afterExternal;
    if (!tabs || !activeTab) return afterExternal;
    const tab = tabs.find((t) => t.key === activeTab);
    if (!tab) return afterExternal;
    return afterExternal.filter(tab.filter);
  }, [afterExternal, tabs, activeTab, serverMode]);

  const afterSearch = useMemo(() => {
    if (serverMode) return afterTab;
    if (!searchQuery.trim()) return afterTab;
    return afterTab.filter((row) => searchFn(row, searchQuery));
  }, [afterTab, searchQuery, searchFn, serverMode]);

  const afterSort = useMemo(() => {
    if (!sortKey) return afterSearch;
    const col = visibleColumns.find((c) => c.key === sortKey);
    if (!col) return afterSearch;
    const fn = col.sortFn ?? defaultSortFn(col);
    const sorted = [...afterSearch].sort(fn);
    return sortDesc ? sorted.reverse() : sorted;
  }, [afterSearch, sortKey, sortDesc, visibleColumns]);

  const effectivePageSize = pageSize === 0 ? afterSort.length : pageSize;
  const pageRows = serverMode
    ? afterSort
    : afterSort.slice(page * effectivePageSize, (page + 1) * effectivePageSize);

  const allOnPageSelected =
    pageRows.length > 0 &&
    pageRows.every((row) => selected.has(String(row[rowKey as keyof T])));

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        pageRows.forEach((row) => next.delete(String(row[rowKey as keyof T])));
      } else {
        pageRows.forEach((row) => next.add(String(row[rowKey as keyof T])));
      }
      onSelectionChange?.(next);
      return next;
    });
  }, [allOnPageSelected, pageRows, rowKey, onSelectionChange]);

  const toggleSelect = useCallback(
    (id: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        onSelectionChange?.(next);
        return next;
      });
    },
    [onSelectionChange]
  );

  const handleSort = useCallback(
    (key: string) => {
      if (sortKey === key) {
        setSortDesc((d) => !d);
      } else {
        setSortKey(key);
        setSortDesc(false);
      }
      setPage(0);
    },
    [sortKey]
  );

  const handleSortDirectional = useCallback(
    (key: string, direction: "asc" | "desc") => {
      setSortKey(key);
      setSortDesc(direction === "desc");
      setPage(0);
    },
    []
  );

  const handleTabChange = useCallback(
    (key: string) => {
      if (onTabChange) {
        onTabChange(key);
      } else {
        setInternalActiveTab(key);
      }
      setPage(0);
      setSelected(new Set());
    },
    [onTabChange]
  );

  const handleBulkAction = useCallback(
    async (action: BulkAction) => {
      setBulkLoading(true);
      try {
        await action.onClick(selected);
        setSelected(new Set());
      } finally {
        setBulkLoading(false);
      }
    },
    [selected]
  );

  if (isLoading) {
    return (
      <div>
        {tabs && (
          <div className="flex gap-4 border-b border-border px-1 mb-0">
            {tabs.map((t) => (
              <div
                key={t.key}
                className="h-4 w-14 animate-pulse rounded bg-muted my-2.5"
              />
            ))}
          </div>
        )}
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-2 py-3 border-b border-border"
          >
            {selectable && (
              <div className="h-3.5 w-3.5 animate-pulse rounded bg-muted" />
            )}
            {columns.map((col) => (
              <div
                key={col.key}
                className="h-4 animate-pulse rounded bg-muted"
                style={{
                  width: col.width ?? 80,
                  ...(col.flex ? { flex: 1, minWidth: col.minWidth ?? 80 } : {}),
                }}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="relative min-w-0">
      {/* min-h-10 only when tabs absent; xs-button-only row (~28px) would
          otherwise crowd the page header above. */}
      {(tabs || isSearchable || toolbarSlot) && (
        <div className={`flex items-center justify-between mb-2 ${tabs ? "" : " min-h-10"}`}>
          {tabs ? (
            <TabBar
              tabs={tabs}
              activeTab={activeTab}
              tabCounts={tabCounts}
              onTabChange={handleTabChange}
            />
          ) : (
            <div />
          )}

          <div className="flex items-center">
            {isSearchable && (
              <div className="flex items-center">
                <button
                  onClick={() => {
                    if (searchOpen && !searchQuery) {
                      setSearchOpen(false);
                    } else {
                      setSearchOpen(true);
                    }
                  }}
                  className="rounded p-1.5 text-foreground hover:bg-muted transition-colors flex-shrink-0"
                >
                  <Search className="h-3.5 w-3.5" />
                </button>
                <div
                  className="overflow-hidden transition-all duration-200 ease-out"
                  style={{ width: searchOpen ? 176 : 0, opacity: searchOpen ? 1 : 0 }}
                >
                  <input
                    autoFocus={searchOpen}
                    ref={(el) => { if (el && searchOpen) el.focus(); }}
                    type="text"
                    name="dt-search"
                    autoComplete="off"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPage(0);
                      serverMode?.onSearchChange?.(e.target.value);
                    }}
                    onBlur={() => {
                      if (!searchQuery) setSearchOpen(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setSearchQuery("");
                        setSearchOpen(false);
                        setPage(0);
                      }
                    }}
                    placeholder={searchPlaceholder}
                    className="w-full border-b border-ring bg-transparent px-1 py-1 text-sm outline-none placeholder:text-text-disabled"
                  />
                </div>
              </div>
            )}
            {toolbarSlot}
          </div>
        </div>
      )}

      {/* Bleed past parent's px-* gutter; box-content + re-inset keeps the
          gutter at scroll-ends but spans full width mid-scroll. */}
      <div className="overflow-x-auto -mx-4 @[768px]:-mx-10 @[1024px]:-mx-12 @max-[640px]:[scrollbar-width:none] @max-[640px]:[-ms-overflow-style:none] @max-[640px]:[&::-webkit-scrollbar]:hidden">
      <div className="px-4 @[768px]:px-10 @[1024px]:px-12 pb-3 box-content" style={{ minWidth: tableMinWidth }}>

      <div
        ref={headerRowRef}
        className="flex items-center px-2 border-b border-border"
        style={{ gap: 0, height: 32 }}
      >
        {selectable && (
          <div
            className="flex items-center justify-center"
            style={{ width: 36, flexShrink: 0 }}
          >
            <input
              type="checkbox"
              checked={allOnPageSelected}
              onChange={toggleSelectAll}
              data-test="row-select-all"
              className="h-3.5 w-3.5 rounded border-border-strong accent-ringcursor-pointer"
            />
          </div>
        )}
        {visibleColumns.length > 0 && (() => {
          const col = visibleColumns[0];
          const canSort = !!col.sortable;
          const isActive = sortKey === col.key;
          return (
            <div
              data-col-key={col.key}
              style={{
                ...getColumnStyle(col, columnWidths?.[col.key]),
                textAlign: col.align ?? "left",
                position: "relative",
              }}
              className={`flex items-center h-8 px-2 ${col.align === "right" ? "justify-end" : ""}`}
            >
              {col.headerRender ? (
                col.headerRender({
                  sorted: sortKey === col.key ? (sortDesc ? "desc" : "asc") : false,
                  onSort: (dir) => handleSortDirectional(col.key, dir),
                })
              ) : canSort ? (
                <button
                  onClick={() => handleSort(col.key)}
                  className="group inline-flex items-center gap-0.5 text-sm text-foreground hover:text-foreground transition-colors"
                >
                  {col.header}
                  {isActive ? (
                    sortDesc ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronUp className="h-3 w-3 opacity-0 group-hover:opacity-30" />
                  )}
                </button>
              ) : (
                <span className="text-sm text-foreground">{col.header}</span>
              )}
              {onColumnResize && (
                <div
                  onMouseDown={(e) => startResize(col.key, e)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    const root = headerRowRef.current?.parentElement;
                    if (!root) return;
                    const cells = root.querySelectorAll<HTMLElement>(`[data-col-key="${col.key}"]`);
                    let maxW = 0;
                    cells.forEach((cell) => {
                      const prev = { width: cell.style.width, minWidth: cell.style.minWidth, flex: cell.style.flex, overflow: cell.style.overflow };
                      cell.style.width = "auto"; cell.style.minWidth = "0"; cell.style.flex = "none"; cell.style.overflow = "visible";
                      maxW = Math.max(maxW, cell.scrollWidth);
                      cell.style.width = prev.width; cell.style.minWidth = prev.minWidth; cell.style.flex = prev.flex; cell.style.overflow = prev.overflow;
                    });
                    const fitWidth = Math.max(50, Math.min(maxW + 8, 600));
                    onColumnResize(col.key, fitWidth);
                    cells.forEach((cell) => { cell.style.width = `${fitWidth}px`; cell.style.minWidth = `${fitWidth}px`; cell.style.flex = "none"; });
                  }}
                  className="absolute top-0 -right-[5px] w-[10px] h-full cursor-col-resize z-10 group/resize"
                >
                  <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-[5px] rounded-full bg-transparent group-hover/resize:bg-ring transition-colors" />
                </div>
              )}
            </div>
          );
        })()}
        <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragStart={handleHeaderDragStart} onDragEnd={handleHeaderDragEnd} onDragCancel={handleHeaderDragCancel}>
          <SortableContext items={visibleColumns.slice(1).map((c) => c.key)} strategy={horizontalListSortingStrategy}>
            {visibleColumns.slice(1).map((col) => {
              const canSort = !!col.sortable;
              const isActive = sortKey === col.key;
              return (
                <SortableHeaderCell
                  key={col.key}
                  id={col.key}
                  style={{
                    ...getColumnStyle(col, columnWidths?.[col.key]),
                    textAlign: col.align ?? "left",
                    position: "relative",
                  }}
                  className={`flex items-center h-8 px-2 ${col.align === "right" ? "justify-end" : ""}`}
                  disabled={!onColumnReorder}
                >
                  {col.headerRender ? (
                    col.headerRender({
                      sorted: sortKey === col.key ? (sortDesc ? "desc" : "asc") : false,
                      onSort: (dir) => handleSortDirectional(col.key, dir),
                    })
                  ) : canSort ? (
                    <button
                      onClick={() => handleSort(col.key)}
                      className="group inline-flex items-center gap-0.5 text-sm text-foreground hover:text-foreground transition-colors"
                    >
                      {col.header}
                      {isActive ? (
                        sortDesc ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronUp className="h-3 w-3" />
                        )
                      ) : (
                        <ChevronUp className="h-3 w-3 opacity-0 group-hover:opacity-30" />
                      )}
                    </button>
                  ) : (
                    <span className="text-sm text-foreground">{col.header}</span>
                  )}
                  {onColumnResize && (
                    <div
                      onMouseDown={(e) => startResize(col.key, e)}
                      onPointerDown={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        // Auto-fit: temporarily strip width constraints to measure natural content width.
                        const root = headerRowRef.current?.parentElement;
                        if (!root) return;
                        const cells = root.querySelectorAll<HTMLElement>(`[data-col-key="${col.key}"]`);
                        let maxW = 0;
                        cells.forEach((cell) => {
                          const prev = { width: cell.style.width, minWidth: cell.style.minWidth, flex: cell.style.flex, overflow: cell.style.overflow };
                          cell.style.width = "auto";
                          cell.style.minWidth = "0";
                          cell.style.flex = "none";
                          cell.style.overflow = "visible";
                          maxW = Math.max(maxW, cell.scrollWidth);
                          cell.style.width = prev.width;
                          cell.style.minWidth = prev.minWidth;
                          cell.style.flex = prev.flex;
                          cell.style.overflow = prev.overflow;
                        });
                        const fitWidth = Math.max(50, Math.min(maxW + 8, 600));
                        onColumnResize(col.key, fitWidth);
                        cells.forEach((cell) => {
                          cell.style.width = `${fitWidth}px`;
                          cell.style.minWidth = `${fitWidth}px`;
                          cell.style.flex = "none";
                        });
                      }}
                      className="absolute top-0 -right-[5px] w-[10px] h-full cursor-col-resize z-10 group/resize"
                    >
                      <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-[5px] rounded-full bg-transparent group-hover/resize:bg-ring transition-colors" />
                    </div>
                  )}
                </SortableHeaderCell>
              );
            })}
          </SortableContext>

          <DragOverlay dropAnimation={{ duration: 150, easing: "ease" }}>
            {activeHeaderId ? (() => {
              const col = visibleColumns.find((c) => c.key === activeHeaderId);
              if (!col) return null;
              return (
                <SortableHeaderCell
                  id={col.key}
                  isDragOverlay
                  style={{
                    ...getColumnStyle(col, columnWidths?.[col.key]),
                    textAlign: col.align ?? "left",
                    position: "relative",
                  }}
                  className={`flex items-center h-8 px-2 ${col.align === "right" ? "justify-end" : ""} bg-surface-overlay`}
                >
                  <span className="text-sm text-foreground">{col.header}</span>
                </SortableHeaderCell>
              );
            })() : null}
          </DragOverlay>
        </DndContext>
        {extraHeaderSlot && (
          <div className="flex items-center px-2" style={{ flexShrink: 0, width: 60 }}>
            {extraHeaderSlot}
          </div>
        )}
      </div>

      {pageRows.length === 0 && !serverMode?.loadMore.isLoadingMore ? (
        <EmptyState
          title={data.length === 0 ? tc("table.noItemsYet") : tc("table.noItemsMatch")}
          className="py-8"
        />
      ) : (
        <div>
          {pageRows.map((row) => {
            const id = String(row[rowKey as keyof T]);
            const isSelected = selected.has(id);
            return (
              <div
                key={id}
                data-row-id={id}
                onClick={(e) => { if (e.currentTarget.contains(e.target as Node)) onRowClick?.(row, e); }}
                className={`group/row flex items-stretch px-2 border-b border-border transition-colors ${
                  onRowClick ? "cursor-pointer" : ""
                } ${isSelected ? "bg-info-bg" : ""}`}
                style={{ gap: 0 }}
              >
                {selectable && (
                  <div
                    className="flex items-center justify-center"
                    style={{ width: 36, flexShrink: 0 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(id)}
                      data-test="row-select"
                      className="h-3.5 w-3.5 rounded border-border-strong accent-ringcursor-pointer"
                    />
                  </div>
                )}
                {visibleColumns.map((col) => {
                  const getVal =
                    col.getValue ??
                    ((r: T) => (r as Record<string, unknown>)[col.key]);
                  const value = getVal(row);
                  const isEditable = typeof col.editable === "function" ? col.editable(row) : !!col.editable;
                  const clickable = isEditable && onCellClick;
                  return (
                    <div
                      key={col.key}
                      data-col-key={col.key}
                      style={{
                        ...getColumnStyle(col, columnWidths?.[col.key]),
                        textAlign: col.align ?? "left",
                      }}
                      onClick={(e) => {
                        if (clickable && e.currentTarget.contains(e.target as Node)) {
                          e.stopPropagation();
                          onCellClick!(id, col.key, e.currentTarget, e);
                        }
                      }}
                      className={`group/cell px-2 py-2 min-w-0 relative overflow-hidden transition-colors ${col.align === "right" ? "flex justify-end items-center" : "flex items-center"} border-r border-border ${clickable ? `cursor-pointer${col.cellHover !== false ? " hover:bg-muted" : ""}` : isEditable ? `${col.cellHover !== false ? "hover:bg-muted " : ""}cursor-pointer` : "cursor-default"}`}
                    >
                      <div className="min-w-0 w-full">
                        {col.render ? (
                          col.render(value, row)
                        ) : value == null || value === "" ? null : (
                          <span className="text-sm text-foreground truncate">
                            {String(value)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {extraHeaderSlot && (
                  <div style={{ flexShrink: 0, width: 60 }} />
                )}
              </div>
            );
          })}
          {serverMode?.loadMore.isLoadingMore && (
            Array.from({ length: 2 }).map((_, i) => (
              <div
                key={`load-more-skeleton-${i}`}
                className="flex items-center gap-4 px-2 py-3 border-b border-border"
              >
                {selectable && (
                  <div className="h-3.5 w-3.5 animate-pulse rounded bg-muted" />
                )}
                {visibleColumns.map((col) => (
                  <div
                    key={col.key}
                    className="h-4 animate-pulse rounded bg-muted"
                    style={{
                      width: col.width ?? 80,
                      ...(col.flex ? { flex: 1, minWidth: col.minWidth ?? 80 } : {}),
                    }}
                  />
                ))}
              </div>
            ))
          )}
          {serverMode && (
            <div ref={loadMoreSentinelRef} aria-hidden style={{ height: 1 }} />
          )}
        </div>
      )}

      {showCalculateRow && onCalculationChange && (
        <CalculateRow
          visibleColumns={visibleColumns}
          columnWidths={columnWidths}
          calculations={calculations ?? {}}
          onCalculationChange={onCalculationChange}
          selectable={selectable}
          columnConfig={columnConfig}
          extraHeaderSlot={extraHeaderSlot}
        />
      )}

      </div>
      </div>

      {selectable && selected.size > 0 && bulkActions && bulkActions.length > 0 && (
        <SelectionActionBar
          count={selected.size}
          actions={bulkActions.map((action) => ({
            label: action.label,
            onClick: () => handleBulkAction(action),
            variant: action.variant,
            icon: action.icon,
            dataTest: action.dataTest,
          }))}
          onClear={() => setSelected(new Set())}
          loading={bulkLoading}
        />
      )}
    </div>
  );
}
