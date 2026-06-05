"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Loader2, Mail, Plug } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Revealed agent-working steps for this assistant turn. */
  steps?: string[];
  /** How many of `steps` have been revealed so far. */
  revealed?: number;
  /** True while the turn is still streaming (last step shimmers). */
  streaming?: boolean;
  /** A connect-Instagram ask rendered inline (demo step 5). */
  connectPrompt?: { handle: string };
  /** A delivered/drafted DM body to show inline. */
  dm?: { handle: string; body: string; delivered: boolean };
  /** An inbound creator reply (📩). */
  inbound?: boolean;
}

/** One revealed agent step — done rows get a check, the active row shimmers. */
function StepRow({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {active ? (
        <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-text-subtle" />
      ) : (
        <Check className="h-3.5 w-3.5 flex-shrink-0 text-success" />
      )}
      <span
        className={cn(
          "leading-snug",
          active ? "tool-shimmer-active" : "text-text-secondary",
        )}
      >
        {label}
      </span>
    </div>
  );
}

export function MessageBubble({
  turn,
  onConnect,
}: {
  turn: ChatTurn;
  onConnect?: (handle: string) => void;
}) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm leading-relaxed text-accent-foreground">
          {turn.content}
        </div>
      </div>
    );
  }

  const steps = turn.steps ?? [];
  const revealed = turn.revealed ?? steps.length;
  const visibleSteps = steps.slice(0, revealed);
  const hasReply = turn.content.length > 0;

  if (turn.inbound) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-border bg-surface-sunken px-3.5 py-2.5">
        <Mail className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-secondary" />
        <p className="text-sm leading-relaxed text-foreground">{turn.content}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {visibleSteps.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-sunken px-3.5 py-2.5">
          {visibleSteps.map((s, i) => (
            <StepRow
              key={i}
              label={s}
              active={turn.streaming === true && i === revealed - 1 && !hasReply}
            />
          ))}
        </div>
      )}

      {turn.streaming && !hasReply && visibleSteps.length === 0 && (
        <div className="ai-typing text-text-muted">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </div>
      )}

      {hasReply && (
        <div className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground prose-p:my-1.5 prose-headings:text-foreground prose-strong:text-foreground prose-a:text-link">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.content}</ReactMarkdown>
        </div>
      )}

      {turn.dm && (
        <div className="rounded-xl border border-border bg-surface-raised p-3.5 shadow-sm">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-secondary">
            {turn.dm.delivered ? (
              <>
                <Check className="h-3.5 w-3.5 text-success" /> Sent to @
                {turn.dm.handle}
              </>
            ) : (
              <>
                <Mail className="h-3.5 w-3.5" /> Draft DM to @{turn.dm.handle}
              </>
            )}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {turn.dm.body}
          </p>
        </div>
      )}

      {turn.connectPrompt && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning bg-warning-bg px-3.5 py-3">
          <Plug className="h-4 w-4 flex-shrink-0 text-warning-bg-foreground" />
          <p className="flex-1 text-sm text-warning-bg-foreground">
            Connect Instagram to send this DM to @{turn.connectPrompt.handle}.
          </p>
          <button
            type="button"
            onClick={() => onConnect?.(turn.connectPrompt!.handle)}
            className="flex-shrink-0 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-text-inverse transition-colors hover:bg-foreground-hover"
          >
            Connect Instagram
          </button>
        </div>
      )}
    </div>
  );
}
