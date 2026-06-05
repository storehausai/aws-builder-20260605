import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// `aria-invalid="true"` switches border to danger (no `tone` prop —
// ARIA already carries the semantic signal).

const inputVariants = cva(
  "flex w-full rounded-md border border-input bg-background text-foreground placeholder:text-text-disabled transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground focus-visible:outline-none focus-visible:border-input-focus disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger",
  {
    variants: {
      size: {
        sm: "h-8 px-2.5 text-xs",
        md: "h-10 px-3 py-2 text-sm",
        lg: "h-11 px-4 text-base",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, size, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        className={cn(inputVariants({ size, className }))}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input, inputVariants };
