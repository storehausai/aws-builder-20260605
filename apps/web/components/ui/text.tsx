import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const textVariants = cva("", {
  variants: {
    size: {
      "2xs": "text-2xs",
      xs: "text-xs",
      caption: "text-caption",
      sm: "text-sm",
      base: "text-base",
      // Scales 16px → 18px at sm: for marketing hero/section subcopy.
      "body-responsive": "text-base sm:text-lg",
      md: "text-md",
      lg: "text-lg",
      xl: "text-xl",
      "2xl": "text-2xl",
      "3xl": "text-3xl",
      "4xl": "text-4xl",
      "5xl": "text-5xl",
      "6xl": "text-6xl",
      "7xl": "text-7xl",
    },
    weight: {
      regular: "font-regular",
      medium: "font-medium",
      semibold: "font-semibold",
      bold: "font-bold",
    },
    leading: {
      none: "leading-none",
      tight: "leading-tight",
      snug: "leading-snug",
      normal: "leading-normal",
      relaxed: "leading-relaxed",
    },
    tracking: {
      tight: "tracking-tight",
      snug: "tracking-snug",
      normal: "tracking-normal",
      wide: "tracking-wide",
      wider: "tracking-wider",
      widest: "tracking-widest",
    },
    tone: {
      default: "text-foreground",
      // Notion 5-step hierarchy: secondary → muted → subtle → hint → disabled.
      secondary: "text-text-secondary",
      muted: "text-text-muted",
      subtle: "text-text-subtle",
      hint: "text-text-hint",
      disabled: "text-text-disabled",
      inverse: "text-text-inverse",
      link: "text-link",
      primary: "text-ink",
      // For use inside bg-accent containers; pairs with --color-accent-foreground.
      "accent-fg": "text-accent-foreground",
      "accent-fg-soft": "text-accent-foreground/80",
      success: "text-success",
      warning: "text-warning",
      danger: "text-danger",
      info: "text-info",
    },
    tabular: {
      true: "tabular-nums",
    },
    truncate: {
      true: "truncate",
    },
    mono: {
      true: "font-mono",
    },
  },
  defaultVariants: {
    // 14px = Notion-tone dashboard density. Use size="base" for prose.
    size: "sm",
    tone: "default",
  },
});

type TextElement =
  | "span"
  | "p"
  | "div"
  | "em"
  | "strong"
  | "small"
  | "figcaption"
  | "blockquote"
  | "cite"
  | "time"
  | "mark"
  // Headings allowed for compact card/section titles where Heading's
  // smallest variant (subsection=lg) would overshoot.
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6";

export interface TextProps
  extends
    Omit<React.HTMLAttributes<HTMLElement>, "color">,
    VariantProps<typeof textVariants> {
  as?: TextElement;
}

const Text = React.forwardRef<HTMLElement, TextProps>(
  (
    {
      className,
      as = "span",
      size,
      weight,
      leading,
      tracking,
      tone,
      tabular,
      truncate,
      mono,
      ...props
    },
    ref,
  ) => {
    const Element = as as React.ElementType;
    return (
      <Element
        ref={ref}
        data-slot="text"
        className={cn(
          textVariants({
            size,
            weight,
            leading,
            tracking,
            tone,
            tabular,
            truncate,
            mono,
          }),
          className,
        )}
        {...props}
      />
    );
  },
);
Text.displayName = "Text";

export { Text, textVariants };
