"use client";

// The always-present right-hand panel of the chat workspace. When discovery
// returns creators, that decision arrives here as a CreatorsArtifact (lifted
// out of ChatView via onPanelArtifact -> ChatWorkspace) and renders as a clean
// creator-card grid (Notion-tokened, KpiStrip + ContentGrid patterns). With no
// artifact it shows a calm prompt to ask in the chat.
//
// This is the PRIMARY surface (Claude-Artifacts mental model: the artifact is
// the star, the chat is the secondary conversation column).
import {
  CreatorsPanel,
  type CreatorsArtifact,
} from "@/components/chat/CreatorsPanel";
import type { OutreachResult } from "@/lib/api";

export interface PanelArtifact extends CreatorsArtifact {
  viz: "creators";
}

export function PanelHost({
  artifact,
  onOutreach,
}: {
  artifact: PanelArtifact | null;
  onOutreach?: (handle: string, result: OutreachResult) => void;
}) {
  // No artifact yet: a calm, content-first empty state. No icon, no scaffold —
  // just centered copy, so the surface reads as "waiting for content".
  if (!artifact) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background px-6">
        <div className="max-w-sm text-center">
          <p className="text-sm font-medium text-foreground">Your workspace</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Ask in the chat — when I pull up creators who can move your market,
            they appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-background">
      <CreatorsPanel artifact={artifact} onOutreach={onOutreach} />
    </div>
  );
}
