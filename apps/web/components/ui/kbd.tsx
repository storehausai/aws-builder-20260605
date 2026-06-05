import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const kbdVariants = cva("inline-flex items-center justify-center", {
  variants: {
    variant: {
      chip:
        "rounded border border-border bg-surface-sunken font-mono text-foreground",
      ghost: "font-sans tracking-wide text-text-muted",
    },
    size: {
      xs: "h-4 min-w-4 px-1 text-[10px]",
      sm: "h-5 min-w-5 px-1.5 text-xs",
      md: "h-6 min-w-6 px-2 text-sm",
      // ghost variant flows inline; caller's text-* determines size.
      inherit: "h-auto min-w-0 px-0",
    },
  },
  defaultVariants: {
    variant: "chip",
    size: "sm",
  },
});

export interface KbdProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "color">,
    VariantProps<typeof kbdVariants> {}

const Kbd = React.forwardRef<HTMLElement, KbdProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <kbd
        ref={ref}
        data-slot="kbd"
        className={cn(kbdVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Kbd.displayName = "Kbd";

export { Kbd, kbdVariants };
