import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // `[line-height:1]` instead of `leading-none` so twMerge doesn't strip it
  // when a caller's `className` sets `text-*` — TW v4's `text-*` carries an
  // implicit line-height and tailwind-merge groups them as conflicting.
  // Arbitrary-property syntax falls outside that group.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium [line-height:1] transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // CTAs use neutral ink (--color-foreground = warm-12) for Notion-tone
        // aesthetic; brand Sienna stays on --color-primary for brand surfaces
        // only. Hover uses --color-foreground-hover (warm-11) — one step lighter.
        primary:
          "bg-foreground text-text-inverse hover:bg-foreground-hover",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline:
          "border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
        ghost:
          "text-foreground hover:bg-accent hover:text-accent-foreground",
        link: "text-link underline-offset-4 hover:underline",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-11 px-8",
        icon: "h-10 w-10",
        // At text-xs the default 16px icon overpowers the 12px text + 2px
        // stroke reads lighter than glyphs — bump to 15px + stroke-width 2.5.
        xs: "h-auto pl-2 pr-2.5 py-2 text-xs font-semibold gap-1 [&_svg]:size-[15px] [&_svg]:[stroke-width:2.5] [line-height:1]",
        hero: "h-12 px-6 text-md font-medium",
      },
      shape: {
        default: "rounded-md",
        lg: "rounded-lg",
        xl: "rounded-xl",
        pill: "rounded-full px-6",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
      shape: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, shape, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        data-slot="button"
        className={cn(buttonVariants({ variant, size, shape, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
