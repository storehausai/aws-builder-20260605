import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/img?u=<encoded url>
 * A small same-origin image proxy. Instagram's CDN and some logo hosts block
 * hotlinking / set CORS that breaks <img> from our origin, so we fetch
 * server-side and stream the bytes back. Allow-listed hosts only (anti-SSRF).
 */
const ALLOW = [
  /(^|\.)cdninstagram\.com$/i,
  /(^|\.)fbcdn\.net$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)clearbit\.com$/i,
  /(^|\.)google\.com$/i,
  /(^|\.)googleusercontent\.com$/i,
  /(^|\.)gstatic\.com$/i,
  /(^|\.)media-amazon\.com$/i,
  /(^|\.)ssl-images-amazon\.com$/i,
  /(^|\.)dicebear\.com$/i,
];

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams.get("u");
  if (!u) return NextResponse.json({ error: "missing u" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(u);
  } catch {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }
  if (target.protocol !== "https:" || !ALLOW.some((re) => re.test(target.hostname))) {
    return NextResponse.json({ error: "host not allowed" }, { status: 403 });
  }

  try {
    const res = await fetch(target.toString(), {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        accept: "image/avif,image/webp,image/*,*/*;q=0.8",
        referer: `https://${target.hostname}/`,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
    }
    return new NextResponse(res.body, {
      status: 200,
      headers: {
        "content-type": res.headers.get("content-type") ?? "image/jpeg",
        "cache-control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
