import * as React from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const menuItemVariants = cva(
  cn(
    "group relative flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-normal",
    "transition-colors",
    "focus-visible:outline-none",
    "disabled:cursor-not-allowed disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ),
  {
    variants: {
      variant: {
        default: "text-foreground hover:bg-muted",
        destructive: "text-danger hover:bg-danger-bg",
      },
      active: {
        true: "bg-muted",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      active: false,
    },
  },
);

export interface MenuItemProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    VariantProps<typeof menuItemVariants> {
  icon?: React.ComponentType<{ className?: string }>;
  shortcut?: React.ReactNode;
  asChild?: boolean;
  children: React.ReactNode;
}

const MenuItem = React.forwardRef<HTMLButtonElement, MenuItemProps>(
  (
    {
      className,
      variant,
      active,
      icon: Icon,
      shortcut,
      asChild = false,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : "button"}
        data-slot="menu-item"
        className={cn(menuItemVariants({ variant, active }), className)}
        {...props}
      >
        {Icon ? <Icon className="h-4 w-4 flex-shrink-0" /> : null}
        <Slottable>{children}</Slottable>
        {shortcut ? (
          <span className="ml-auto text-text-muted">{shortcut}</span>
        ) : null}
      </Comp>
    );
  },
);
MenuItem.displayName = "MenuItem";

export { MenuItem, menuItemVariants };
