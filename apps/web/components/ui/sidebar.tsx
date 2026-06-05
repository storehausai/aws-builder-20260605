"use client";

import * as React from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const SIDEBAR_WIDTH = {
  collapsed: "w-[56px]",
  expanded: "w-[260px]",
} as const;

type SidebarContextValue = {
  collapsed: boolean;
};

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

function useSidebarContext(): SidebarContextValue {
  const ctx = React.useContext(SidebarContext);
  return ctx ?? { collapsed: false };
}

interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
  collapsed?: boolean;
}

const Sidebar = React.forwardRef<HTMLElement, SidebarProps>(
  ({ className, collapsed = false, children, ...props }, ref) => (
    <SidebarContext.Provider value={{ collapsed }}>
      <aside
        ref={ref}
        data-slot="sidebar"
        data-collapsed={collapsed ? "true" : "false"}
        className={cn(
          "flex h-full flex-col overflow-hidden bg-surface-sunken border-r border-border",
          "flex-shrink-0 transition-[width] duration-200 ease-in-out",
          collapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded,
          className,
        )}
        {...props}
      >
        {children}
      </aside>
    </SidebarContext.Provider>
  ),
);
Sidebar.displayName = "Sidebar";

const SidebarHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { collapsed } = useSidebarContext();
  // Collapsed: center 32px toggle on 56px rail (matches body icons).
  return (
    <div
      ref={ref}
      data-slot="sidebar-header"
      className={cn(
        "flex h-12 flex-shrink-0 items-center px-2",
        collapsed && "justify-center",
        className,
      )}
      {...props}
    />
  );
});
SidebarHeader.displayName = "SidebarHeader";

const SidebarBody = React.forwardRef<
  HTMLElement,
  React.HTMLAttributes<HTMLElement>
>(({ className, ...props }, ref) => (
  <nav
    ref={ref}
    data-slot="sidebar-body"
    // overflow-x-hidden load-bearing: spec auto-promotes x→auto when y=auto,
    // producing a stray horizontal scrollbar at collapsed-rail width.
    className={cn(
      "flex flex-1 flex-col overflow-y-auto overflow-x-hidden pt-2",
      className,
    )}
    {...props}
  />
));
SidebarBody.displayName = "SidebarBody";

const SidebarFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="sidebar-footer"
    className={cn(
      "flex flex-shrink-0 flex-col pb-2 sm:pb-4 pt-2 px-2",
      className,
    )}
    {...props}
  />
));
SidebarFooter.displayName = "SidebarFooter";

interface SidebarSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string;
}

const SidebarSection = React.forwardRef<HTMLDivElement, SidebarSectionProps>(
  ({ className, label, children, ...props }, ref) => {
    const { collapsed } = useSidebarContext();
    return (
      <div
        ref={ref}
        data-slot="sidebar-section"
        className={cn("flex flex-shrink-0 flex-col space-y-px", className)}
        {...props}
      >
        {label && !collapsed ? (
          <div
            data-slot="sidebar-section-label"
            className="px-3 py-1 text-2xs font-semibold uppercase tracking-wider text-text-disabled"
          >
            {label}
          </div>
        ) : null}
        {children}
      </div>
    );
  },
);
SidebarSection.displayName = "SidebarSection";

const sidebarItemVariants = cva(
  cn(
    "group relative flex w-full items-center rounded-lg px-3 py-[5px] text-sm font-normal",
    "text-foreground transition-colors",
    "focus-visible:outline-none",
    "disabled:cursor-not-allowed disabled:opacity-50",
  ),
  {
    variants: {
      active: {
        true: "bg-accent font-medium text-foreground",
        false: "hover:bg-muted",
      },
    },
    defaultVariants: {
      active: false,
    },
  },
);

interface SidebarItemProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    VariantProps<typeof sidebarItemVariants> {
  icon?: React.ComponentType<{ className?: string }>;
  badge?: React.ReactNode;
  shortcut?: React.ReactNode;
  asChild?: boolean;
  children: React.ReactNode;
}

const SidebarItem = React.forwardRef<HTMLButtonElement, SidebarItemProps>(
  (
    {
      className,
      active,
      icon: Icon,
      badge,
      shortcut,
      asChild = false,
      children,
      ...props
    },
    ref,
  ) => {
    const { collapsed } = useSidebarContext();

    // Two render paths so Icon stays pinned during 260↔56px collapse.
    // asChild uses transition-[color]→text-transparent on Slot itself
    // (Radix React.Children.only blocks wrapping); Icon is absolute +
    // pointer-events-none so clicks fall through.
    if (asChild) {
      return (
        <div
          data-slot="sidebar-item"
          data-active={active ? "true" : "false"}
          className={cn(
            sidebarItemVariants({ active }),
            // Clipping prevents the 52px padding spillover from inflating the
            // scroll container's scrollWidth — dnd-kit autoScroll would
            // otherwise shift icons left on drag-start.
            "h-[30px] overflow-hidden",
            className,
          )}
        >
          {Icon ? (
            <Icon
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 pointer-events-none"
            />
          ) : null}
          <Slot
            ref={ref as React.Ref<HTMLAnchorElement>}
            className={cn(
              "absolute inset-0 flex items-center rounded-lg pl-10 pr-3",
              "whitespace-nowrap overflow-hidden",
              "transition-[color] duration-200 ease-in-out",
              collapsed && "text-transparent",
            )}
            {...props}
          >
            <Slottable>{children}</Slottable>
            {!collapsed && shortcut ? (
              <span className="ml-auto hidden text-text-muted group-hover:inline">
                {shortcut}
              </span>
            ) : null}
            {!collapsed && badge ? (
              <span className="ml-auto">{badge}</span>
            ) : null}
          </Slot>
        </div>
      );
    }

    return (
      <button
        ref={ref}
        type="button"
        data-slot="sidebar-item"
        data-active={active ? "true" : "false"}
        className={cn(
          sidebarItemVariants({ active }),
          "overflow-hidden",
          className,
        )}
        {...props}
      >
        {Icon ? <Icon className="h-4 w-4 flex-shrink-0" /> : null}
        <span
          className={cn(
            "ml-3 whitespace-nowrap transition-opacity duration-200 ease-in-out",
            collapsed && "opacity-0",
          )}
        >
          {children}
        </span>
        {!collapsed && shortcut ? (
          <span className="ml-auto hidden text-text-muted group-hover:inline">
            {shortcut}
          </span>
        ) : null}
        {!collapsed && badge ? (
          <span className="ml-auto">{badge}</span>
        ) : null}
      </button>
    );
  },
);
SidebarItem.displayName = "SidebarItem";

interface SidebarItemBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  count: number;
  tone?: "danger" | "muted";
}

const SidebarItemBadge = React.forwardRef<HTMLSpanElement, SidebarItemBadgeProps>(
  ({ className, count, tone = "danger", ...props }, ref) => {
    if (count <= 0) return null;
    return (
      <span
        ref={ref}
        data-slot="sidebar-item-badge"
        className={cn(
          "inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-2xs font-bold",
          tone === "danger"
            ? "bg-danger text-danger-foreground"
            : "bg-muted text-text-muted",
          className,
        )}
        {...props}
      >
        {count > 99 ? "99+" : count}
      </span>
    );
  },
);
SidebarItemBadge.displayName = "SidebarItemBadge";

export {
  Sidebar,
  SidebarHeader,
  SidebarBody,
  SidebarFooter,
  SidebarSection,
  SidebarItem,
  SidebarItemBadge,
  sidebarItemVariants,
};
