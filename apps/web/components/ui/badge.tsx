import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center border transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-ink text-white shadow",
        neutral:
          "border-transparent bg-muted text-foreground",
        outline: "border-border text-foreground",
        brand:
          "border-transparent bg-foreground text-brand-foreground",
        success:
          "border-transparent bg-success-bg text-success-bg-foreground",
        warning:
          "border-transparent bg-warning-bg text-warning-bg-foreground",
        danger:
          "border-transparent bg-danger-bg text-danger-bg-foreground",
        info:
          "border-transparent bg-info-bg text-info-bg-foreground",
        soon:
          "border-transparent bg-muted text-muted-foreground",
      },
      size: {
        xs:      "text-[10px] leading-[14px] px-1.5 py-0 font-medium tracking-wider uppercase",
        sm:      "text-[11px] px-1.5 py-0.5 font-medium",
        default: "text-sm px-2.5 py-0.5 font-normal",
      },
      shape: {
        default: "rounded-md",
        pill: "rounded-full",
      },
      elevation: {
        default: "",
        flat: "shadow-none",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      shape: "default",
      elevation: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, shape, elevation, ...props }: BadgeProps) {
  return (
    <div
      data-slot="badge"
      className={cn(badgeVariants({ variant, size, shape, elevation }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
