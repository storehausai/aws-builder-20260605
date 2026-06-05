/**
 * The agent's output artifact — what gets rendered in the chat's right panel.
 *
 * All variants render inside an ISOLATED-ORIGIN sandboxed iframe (never the
 * app's own origin) — the Claude-Artifacts model. No E2B / VM; just a browser
 * iframe + a preloaded React runtime + the @pebble/panels component library.
 *
 *   v1  →  format: "react" — the AI writes JSX that IMPORTS @pebble/panels and
 *          renders the engine-computed data bundle. Shared components give
 *          consistency + reuse + easy edits.
 *   alt →  format: "html"  — a self-contained HTML string (simplest fallback /
 *          escape-hatch for one-offs the component library can't express).
 *   dest → format: "spec"  — a constrained JSON spec naming the SAME
 *          @pebble/panels components (max safety/determinism). Additive: the
 *          component library is shared with "react", so it's not a rewrite.
 *
 * See docs/ui-format-decision.md for the evidence and migration path.
 */

import type { ProviderId, Timestamp } from "./primitives";

/** Reserved for the destination: a constrained JSON spec → trusted renderer. */
export interface PanelSpec {
  version: string;
  [key: string]: unknown;
}

export type PanelArtifact =
  | { format: "react"; source: string } // JSX importing @pebble/panels (v1)
  | { format: "html"; html: string } // self-contained HTML (escape-hatch)
  | { format: "spec"; spec: PanelSpec }; // constrained spec (destination)

export interface GeneratedPanel {
  title: string;
  artifact: PanelArtifact;
  meta: {
    storeId: string;
    requestId?: string;
    generatedAt: Timestamp;
    /** which providers contributed data to this panel (provenance). */
    sources?: ProviderId[];
  };
}
