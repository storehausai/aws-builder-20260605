import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

// Reuses Button color variants via buttonVariants. `label` (aria-label)
// is REQUIRED — icon-only buttons must carry an accessible name (WCAG 4.1.2).

const iconButtonSizes = {
  xs: "h-6 w-6 rounded [&_svg]:size-3",
  sm: "h-8 w-8 rounded-md [&_svg]:size-4",
  md: "h-10 w-10 rounded-md [&_svg]:size-4",
  lg: "h-12 w-12 rounded-lg [&_svg]:size-5",
} as const;

const iconButtonVariants = cva("p-0", {
  variants: {
    size: iconButtonSizes,
  },
  defaultVariants: {
    size: "md",
  },
});

type IconButtonVariant = NonNullable<
  Parameters<typeof buttonVariants>[0]
>["variant"];

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">,
    VariantProps<typeof iconButtonVariants> {
  // Accessible name. Required for icon-only buttons.
  label: string;
  variant?: IconButtonVariant;
  asChild?: boolean;
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    { className, label, variant, size, asChild = false, children, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : "button"}
        data-slot="icon-button"
        aria-label={label}
        className={cn(
          buttonVariants({ variant, size: "icon" }),
          iconButtonVariants({ size }),
          className,
        )}
        {...props}
      >
        {children}
      </Comp>
    );
  },
);
IconButton.displayName = "IconButton";

export { IconButton, iconButtonVariants };
