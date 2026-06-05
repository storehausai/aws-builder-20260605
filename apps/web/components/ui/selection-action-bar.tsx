"use client"

import { type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { X, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export interface SelectionAction {
  label: string
  onClick: () => void | Promise<void>
  variant?: "default" | "danger"
  icon?: ReactNode
  dataTest?: string
}

interface SelectionActionBarProps {
  count: number
  actions: SelectionAction[]
  onClear: () => void
  loading?: boolean
  className?: string
}

export function SelectionActionBar({
  count,
  actions,
  onClear,
  loading = false,
  className,
}: SelectionActionBarProps) {
  const tc = useTranslations("common")
  if (count === 0) return null

  return (
    <div
      className={cn(
        "sticky bottom-4 mx-auto w-fit flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 shadow-lg z-10",
        "animate-in slide-in-from-bottom-4 fade-in duration-200",
        className
      )}
    >
      <span className="text-sm font-medium text-foreground tabular-nums">
        {tc("action.selected", { count })}
      </span>
      <div className="h-3 w-px bg-border" />
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={action.onClick}
          disabled={loading}
          data-test={action.dataTest}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-1 text-sm font-medium transition-colors disabled:opacity-50",
            action.variant === "danger"
              ? "text-danger hover:bg-danger-bg"
              : "text-foreground hover:bg-muted",
          )}
        >
          {action.icon}
          {action.label}
        </button>
      ))}
      {loading && (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" />
      )}
      <div className="h-3 w-px bg-border" />
      <button
        onClick={onClear}
        className="rounded p-0.5 text-text-muted transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
