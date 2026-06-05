import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  variant?: "plain" | "dashed";
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = "plain",
  className,
}: EmptyStateProps) {
  if (variant === "dashed") {
    return (
      <div
        data-slot="empty-state"
        data-variant="dashed"
        className={cn(
          "rounded-lg border border-dashed border-border bg-surface-sunken p-8 text-center",
          className,
        )}
      >
        {icon && <div className="mb-2 inline-flex text-text-disabled">{icon}</div>}
        <p className="text-sm text-text-subtle">{title}</p>
        {description && (
          <p className="mx-auto mt-1 max-w-[320px] text-xs text-text-disabled">
            {description}
          </p>
        )}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-3 text-sm font-medium text-link hover:underline"
          >
            {action.label}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      data-slot="empty-state"
      data-variant="plain"
      className={cn(
        "flex flex-col items-center justify-center py-12 text-center",
        className,
      )}
    >
      {icon && <div className="mb-3 text-text-disabled">{icon}</div>}
      <p className="text-sm font-medium text-text-muted">{title}</p>
      {description && (
        <p className="mt-1 max-w-[280px] text-xs text-text-disabled">
          {description}
        </p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 text-sm font-medium text-link hover:underline"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
