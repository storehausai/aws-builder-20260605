"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Same Context + Portal + body-scroll-lock as Dialog; kept parallel
// (not shared) so animations evolve independently.

const sheetContentVariants = cva(
  cn(
    "fixed z-50 flex flex-col gap-4 border border-border",
    "bg-surface-overlay text-surface-overlay-foreground shadow-lg",
  ),
  {
    variants: {
      side: {
        left: "inset-y-0 left-0 h-full border-r",
        right: "inset-y-0 right-0 h-full border-l",
        top: "inset-x-0 top-0 w-full border-b",
        bottom: "inset-x-0 bottom-0 w-full border-t",
      },
      size: {
        sm: "",
        md: "",
        lg: "",
        xl: "",
        full: "",
      },
      padding: {
        default: "p-6",
        compact: "p-4",
        none: "p-0",
      },
    },
    compoundVariants: [
      { side: "left", size: "sm", className: "w-[280px]" },
      { side: "left", size: "md", className: "w-[360px]" },
      { side: "left", size: "lg", className: "w-[440px]" },
      { side: "left", size: "xl", className: "w-[560px]" },
      { side: "left", size: "full", className: "w-full" },
      { side: "right", size: "sm", className: "w-[280px]" },
      { side: "right", size: "md", className: "w-[360px]" },
      { side: "right", size: "lg", className: "w-[440px]" },
      { side: "right", size: "xl", className: "w-[560px]" },
      { side: "right", size: "full", className: "w-full" },
      { side: "top", size: "sm", className: "h-[30vh]" },
      { side: "top", size: "md", className: "h-[45vh]" },
      { side: "top", size: "lg", className: "h-[60vh]" },
      { side: "top", size: "xl", className: "h-[75vh]" },
      { side: "top", size: "full", className: "h-full" },
      { side: "bottom", size: "sm", className: "h-[30vh]" },
      { side: "bottom", size: "md", className: "h-[45vh]" },
      { side: "bottom", size: "lg", className: "h-[60vh]" },
      { side: "bottom", size: "xl", className: "h-[75vh]" },
      { side: "bottom", size: "full", className: "h-full" },
    ],
    defaultVariants: {
      side: "right",
      size: "md",
      padding: "default",
    },
  },
);

export type SheetContentVariantProps = VariantProps<typeof sheetContentVariants>;

const SIDE_ENTER = {
  left: "slide-in-from-left",
  right: "slide-in-from-right",
  top: "slide-in-from-top",
  bottom: "slide-in-from-bottom",
} as const;

const SIDE_EXIT = {
  left: "slide-out-to-left",
  right: "slide-out-to-right",
  top: "slide-out-to-top",
  bottom: "slide-out-to-bottom",
} as const;

const SheetContext = React.createContext<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>({ open: false, onOpenChange: () => {} });

function useSheet() {
  return React.useContext(SheetContext);
}

function Sheet({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  return (
    <SheetContext.Provider value={{ open: isOpen, onOpenChange: setOpen }}>
      {children}
    </SheetContext.Provider>
  );
}

const SheetTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }
>(({ onClick, children, asChild, ...props }, ref) => {
  const { onOpenChange } = useSheet();
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    onOpenChange(true);
  };
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, {
      onClick: handleClick,
    });
  }
  return (
    <button ref={ref} type="button" onClick={handleClick} {...props}>
      {children}
    </button>
  );
});
SheetTrigger.displayName = "SheetTrigger";

const SheetClose = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }
>(({ onClick, children, asChild, ...props }, ref) => {
  const { onOpenChange } = useSheet();
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    onOpenChange(false);
  };
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, {
      onClick: handleClick,
    });
  }
  return (
    <button ref={ref} type="button" onClick={handleClick} {...props}>
      {children}
    </button>
  );
});
SheetClose.displayName = "SheetClose";

function SheetPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

const SheetOverlay = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { closing?: boolean }
>(({ className, closing, ...props }, ref) => {
  const { onOpenChange } = useSheet();
  return (
    <div
      ref={ref}
      className={cn(
        "fixed inset-0 z-50 bg-foreground/80",
        closing
          ? "animate-out fade-out-0 duration-200"
          : "animate-in fade-in-0 duration-200",
        className,
      )}
      onClick={() => onOpenChange(false)}
      {...props}
    />
  );
});
SheetOverlay.displayName = "SheetOverlay";

function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [locked]);
}

const SheetContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> &
    SheetContentVariantProps & { hideClose?: boolean }
>(
  (
    { className, children, side = "right", size, padding, hideClose, ...props },
    ref,
  ) => {
    const { open, onOpenChange } = useSheet();
    const [visible, setVisible] = useState(false);
    const [closing, setClosing] = useState(false);
    const closingRef = useRef(false);

    useBodyScrollLock(visible);

    useEffect(() => {
      if (open) {
        setVisible(true);
        setClosing(false);
        closingRef.current = false;
      } else if (visible && !closingRef.current) {
        closingRef.current = true;
        setClosing(true);
        const timer = setTimeout(() => {
          setVisible(false);
          setClosing(false);
          closingRef.current = false;
        }, 200);
        return () => clearTimeout(timer);
      }
    }, [open, visible]);

    const handleKeyDown = useCallback(
      (e: KeyboardEvent) => {
        if (e.key === "Escape") onOpenChange(false);
      },
      [onOpenChange],
    );

    useEffect(() => {
      if (!visible) return;
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }, [visible, handleKeyDown]);

    if (!visible) return null;

    const sideKey = (side ?? "right") as keyof typeof SIDE_ENTER;

    return (
      <SheetPortal>
        <SheetOverlay closing={closing} />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          className={cn(
            sheetContentVariants({ side, size, padding }),
            closing
              ? `animate-out fade-out-0 ${SIDE_EXIT[sideKey]} duration-200`
              : `animate-in fade-in-0 ${SIDE_ENTER[sideKey]} duration-200`,
            className,
          )}
          {...props}
        >
          {children}
          {!hideClose ? (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className={cn(
                "absolute right-4 top-4 rounded-sm opacity-70 transition-opacity",
                "hover:opacity-100 focus:outline-none",
              )}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </SheetPortal>
    );
  },
);
SheetContent.displayName = "SheetContent";

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="sheet-header"
    className={cn("flex flex-col space-y-2 text-left", className)}
    {...props}
  />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="sheet-footer"
    className={cn(
      "mt-auto flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    data-slot="sheet-title"
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

const SheetDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    data-slot="sheet-description"
    className={cn("text-sm text-text-muted", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetPortal,
  SheetOverlay,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
