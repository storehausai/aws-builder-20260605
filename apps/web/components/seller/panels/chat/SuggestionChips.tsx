"use client";

import { BarChart2, Flame, Megaphone, Star, TrendingUp, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SuggestionChipsProps {
  onAction: (prompt: string) => void;
  compact?: boolean;
}

// Pebble is a creator-marketing analytics product. Every chip maps onto
// something discovery / outreach can produce.
const CHIPS = [
  {
    icon: Star,
    label: "Find market movers",
    prompt: "Find influencers who can move my market",
  },
  {
    icon: Zap,
    label: "Competitor bursts",
    prompt: "Who drove my competitors' sales bursts?",
  },
  {
    icon: Megaphone,
    label: "Draft outreach",
    prompt: "Draft outreach to my top creators",
  },
  {
    icon: Flame,
    label: "Breakout creators",
    prompt: "Show me breakout creators in my category right now",
  },
  {
    icon: TrendingUp,
    label: "Rising reach",
    prompt: "Which creators are gaining reach the fastest?",
  },
  {
    icon: BarChart2,
    label: "Best fit for my ASINs",
    prompt: "Find the best creators for my seed products",
  },
];

export function SuggestionChips({ onAction, compact = false }: SuggestionChipsProps) {
  const visibleChips = compact ? CHIPS : CHIPS.slice(0, 4);

  return (
    <div
      className={cn(
        "flex gap-2",
        compact
          ? "overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
          : "flex-wrap justify-center",
      )}
    >
      {visibleChips.map((chip) => (
        <Button
          key={chip.label}
          variant="outline"
          shape="pill"
          size={compact ? "xs" : "sm"}
          onClick={() => onAction(chip.prompt)}
          className={
            compact
              ? "px-3 flex-shrink-0 font-normal [&_svg]:[stroke-width:2]"
              : "px-4"
          }
        >
          <chip.icon
            style={
              compact
                ? { height: "12px", width: "12px" }
                : { height: "14px", width: "14px" }
            }
          />
          {chip.label}
        </Button>
      ))}
    </div>
  );
}
