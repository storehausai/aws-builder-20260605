import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createBb, loadPanel } from "@pebble/bb";
import { runPanel } from "@/lib/pipelines.server";
import { panelCard } from "@/lib/panel-card";

/**
 * /panel/[id] — the durable, shareable home of a generated panel.
 *
 * The iMessage worker saves a panel's grounding spec and texts a link here.
 * Photon fetches this page to build the link-preview card (from the OG tags
 * below), and a tap opens the full interactive panel — regenerated on demand
 * from the saved spec so it always reflects the latest panel design.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const panel = await loadPanel(createBb(), id).catch(() => null);
  if (!panel) return { title: "Panel not found" };
  const card = panelCard(panel.spec);
  return {
    title: card.title,
    description: card.summary,
    openGraph: {
      title: card.title,
      description: card.summary,
      type: "website",
      // The colocated opengraph-image.tsx is picked up automatically by Next.
    },
    twitter: { card: "summary_large_image", title: card.title, description: card.summary },
  };
}

export default async function PanelPage({ params }: { params: Params }) {
  const { id } = await params;
  const panel = await loadPanel(createBb(), id).catch(() => null);
  if (!panel) notFound();

  const result = await runPanel({
    brand: panel.spec.brand,
    brandUrl: panel.spec.brandUrl,
    influencers: panel.spec.influencers,
  });

  // The panel is a complete, self-contained HTML document. Render it verbatim
  // in a sandboxed iframe — `allow-scripts` (no `allow-same-origin`) keeps it
  // fully origin-isolated, exactly like the dashboard's right-hand panel.
  return (
    <main style={{ position: "fixed", inset: 0, background: "#fff" }}>
      <iframe
        title={panel.title ?? "Panel"}
        srcDoc={result.html}
        sandbox="allow-scripts"
        style={{ width: "100%", height: "100%", border: "none" }}
      />
    </main>
  );
}
