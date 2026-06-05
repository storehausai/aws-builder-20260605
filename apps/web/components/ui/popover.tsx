"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

interface PopoverWrapperProps
  extends React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Root> {
  // Set to `true` for popovers anchored over an iframe — Radix's native
  // outside-click can't see iframe-internal clicks (cross-origin doesn't
  // propagate pointer events). `false` (default) attaches a transparent
  // overlay that catches dashboard-area dismisses.
  disableOverlay?: boolean;
}

function Popover({
  children,
  open: controlledOpen,
  defaultOpen,
  onOpenChange,
  disableOverlay = false,
  ...props
}: PopoverWrapperProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
    defaultOpen ?? false,
  );
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  // Cross-origin iframe clicks don't bubble to the parent document, so Radix's
  // outside-click can't see them. Detect via window blur + iframe focus-steal.
  React.useEffect(() => {
    if (!open || !disableOverlay) return;
    const onBlur = () => {
      requestAnimationFrame(() => {
        if (document.activeElement?.tagName === "IFRAME") {
          handleOpenChange(false);
        }
      });
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [open, disableOverlay, handleOpenChange]);

  return (
    <>
      <PopoverPrimitive.Root
        open={open}
        onOpenChange={handleOpenChange}
        {...props}
      >
        {children}
      </PopoverPrimitive.Root>
      {open &&
        !disableOverlay &&
        createPortal(
          <div
            className="fixed inset-0 z-40"
            aria-hidden="true"
            onClick={() => handleOpenChange(false)}
          />,
          document.body,
        )}
    </>
  );
}

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      data-slot="popover-content"
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border border-border bg-surface-overlay p-4 text-surface-overlay-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-popover-content-transform-origin]",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

const PopoverClose = PopoverPrimitive.Close;

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent, PopoverClose };
