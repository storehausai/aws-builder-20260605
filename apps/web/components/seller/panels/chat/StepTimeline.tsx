"use client";

import { motion } from "framer-motion";
import {
  Globe,
  Building2,
  Search,
  TrendingUp,
  Tag,
  Users,
  ListOrdered,
  Sparkles,
  Check,
  Loader2,
  Megaphone,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Map a narrated step to the icon for the action it describes. */
function iconFor(step: string) {
  const s = step.toLowerCase();
  if (/read|homepage|\bsite\b|\.com|reading/.test(s)) return Globe;
  if (/competitor/.test(s)) return Building2;
  if (/amazon|product|asin|resolv/.test(s)) return Search;
  if (/bsr|burst|rank trend|sales-rank|spike/.test(s)) return TrendingUp;
  if (/price|discount|gate/.test(s)) return Tag;
  if (/content|\bpr\b|creator|similar|candidate|lookalike|market mover/.test(s)) return Users;
  if (/rank(ing)? the|shortlist|scoring|score/.test(s)) return ListOrdered;
  if (/dm|outreach|message|draft/.test(s)) return Megaphone;
  return Sparkles;
}

/**
 * The agent's work, visualized as a vertical timeline of icon nodes — one per
 * step, connected by a rail, animating in as each lands. The last step pulses
 * while live; earlier steps settle green. This is the "Claude Code working while
 * it talks" surface (demo requirement #3).
 */
export function StepTimeline({ steps, done = false }: { steps: string[]; done?: boolean }) {
  if (steps.length === 0) return null;
  return (
    <div className="rounded-2xl border border-border bg-surface-raised/50 p-3.5">
      <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {done ? (
          <>
            <Check className="h-3 w-3 text-emerald-500" /> Analysis complete
          </>
        ) : (
          <>
            <Loader2 className="h-3 w-3 animate-spin text-foreground" /> Working
          </>
        )}
      </div>

      <div className="relative flex flex-col">
        {steps.map((step, i) => {
          const Icon = iconFor(step);
          const isLast = i === steps.length - 1;
          const isActive = !done && isLast;
          const isSettled = done || !isLast;
          const notFinalRow = i < steps.length - 1;

          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="relative flex items-start gap-3 pb-3.5 last:pb-0"
            >
              {/* connector rail */}
              {notFinalRow && (
                <span className="absolute left-[15px] top-8 h-[calc(100%-16px)] w-px bg-border" aria-hidden />
              )}

              {/* node */}
              <span
                className={cn(
                  "relative z-10 flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full border transition-colors",
                  isActive && "border-foreground/25 bg-background text-foreground",
                  isSettled && "border-emerald-500/25 bg-emerald-500/10 text-emerald-600",
                )}
              >
                {isActive && (
                  <motion.span
                    className="absolute inset-0 rounded-full ring-2 ring-foreground/15"
                    animate={{ opacity: [0.2, 0.6, 0.2], scale: [1, 1.12, 1] }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                    aria-hidden
                  />
                )}
                <Icon className="h-3.5 w-3.5" />
              </span>

              <span
                className={cn(
                  "pt-[5px] text-[13px] leading-snug",
                  isActive ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {step}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
