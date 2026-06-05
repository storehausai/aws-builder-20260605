import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const textareaVariants = cva(
  "flex w-full rounded-md border border-input bg-background text-foreground placeholder:text-text-disabled transition-colors focus-visible:outline-none focus-visible:border-input-focus disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger",
  {
    variants: {
      size: {
        sm: "min-h-16 px-2.5 py-2 text-xs",
        md: "min-h-20 px-3 py-2 text-sm",
        lg: "min-h-28 px-4 py-3 text-base",
      },
      resize: {
        none: "resize-none",
        vertical: "resize-y",
        horizontal: "resize-x",
        both: "resize",
      },
    },
    defaultVariants: {
      size: "md",
      resize: "vertical",
    },
  },
);

export interface TextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "size">,
    VariantProps<typeof textareaVariants> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, size, resize, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        data-slot="textarea"
        className={cn(textareaVariants({ size, resize, className }))}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea, textareaVariants };
