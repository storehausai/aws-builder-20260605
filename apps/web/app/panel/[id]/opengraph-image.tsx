import { ImageResponse } from "next/og";
import { createBb, loadPanel } from "@pebble/bb";
import { panelCard, formatFollowers } from "@/lib/panel-card";

/**
 * The image inside the iMessage link-preview card. Rendered by `next/og`
 * (satori) from the SAME `panelCard()` shaping the meta tags use — so the words
 * on the card and the picture in it always agree. No headless browser, no
 * screenshot: a designed summary built straight from the structured spec.
 */
export const runtime = "nodejs";
export const alt = "Recommended creators";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Params = Promise<{ id: string }>;

const BG = "#0B0B0F";
const ACCENT = "#7C5CFF";
const MUTED = "#9AA0AE";

export default async function Image({ params }: { params: Params }) {
  const { id } = await params;
  const panel = await loadPanel(createBb(), id).catch(() => null);
  const card = panel
    ? panelCard(panel.spec)
    : { title: "Panel", summary: "", featured: [] };

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BG,
          color: "#fff",
          padding: "64px 72px",
          fontFamily: "sans-serif",
        }}
      >
        {/* header */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", color: ACCENT, fontSize: 30, fontWeight: 700 }}>
            ● Storehaus
          </div>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 800, marginTop: 18, lineHeight: 1.1 }}>
            {card.title}
          </div>
          <div style={{ display: "flex", fontSize: 32, color: MUTED, marginTop: 16 }}>
            {card.summary}
          </div>
        </div>

        {/* featured creators */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {card.featured.map((c) => (
            <div
              key={c.handle}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "#15151D",
                borderRadius: 18,
                padding: "22px 28px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", fontSize: 38, fontWeight: 700 }}>
                @{c.handle}
                <span style={{ display: "flex", fontSize: 26, color: MUTED, marginLeft: 18 }}>
                  {c.platform}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", fontSize: 30, color: MUTED }}>
                {formatFollowers(c.followers) ? `${formatFollowers(c.followers)} followers` : ""}
                {c.fitPct != null ? (
                  <span style={{ display: "flex", color: ACCENT, fontWeight: 700, marginLeft: 24 }}>
                    {c.fitPct}% fit
                  </span>
                ) : null}
              </div>
            </div>
          ))}
          <div style={{ display: "flex", fontSize: 26, color: MUTED, marginTop: 8 }}>
            Tap to open the full interactive panel →
          </div>
        </div>
      </div>
    ),
    size,
  );
}
