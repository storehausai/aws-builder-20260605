/**
 * Depth probe for ScrapeCreators TikTok HASHTAG endpoint — does it paginate back
 * in time far enough to reach a burst window weeks/months ago? (Keyword search
 * could not.) Reports per-page date span + whether the cursor keeps advancing.
 */
const KEY = process.env.SCRAPECREATORS_API_KEY!;
const BASE = "https://api.scrapecreators.com";
const tag = (process.argv[2] ?? "rael").replace(/^#/, "");
const MAX_PAGES = Number(process.argv[3] ?? 25);

const decodeMs = (id: unknown): number | null => {
  const s = String(id ?? "");
  if (!/^\d+$/.test(s)) return null;
  try { return Number(BigInt(s) >> 32n) * 1000; } catch { return null; }
};
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const itemsOf = (d: any): any[] =>
  (Array.isArray(d?.search_item_list) && d.search_item_list) ||
  (Array.isArray(d?.aweme_list) && d.aweme_list) ||
  (Array.isArray(d?.videos) && d.videos) || [];
const tsOf = (it: any): number | null =>
  decodeMs(it?.aweme_id) ?? (typeof it?.create_time === "number" ? it.create_time * 1000 : null) ??
  (it?.aweme_info?.aweme_id ? decodeMs(it.aweme_info.aweme_id) : null);

async function main() {
  let cursor: any = 0, total = 0, oldest: number | null = null, credits: any;
  const t0 = Date.now();
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ hashtag: tag, trim: "true", cursor: String(cursor) });
    const res = await fetch(`${BASE}/v1/tiktok/search/hashtag?${params}`, { headers: { "x-api-key": KEY } });
    if (!res.ok) { console.log(`page ${page}: HTTP ${res.status} ${(await res.text()).slice(0,160)}`); break; }
    const data: any = await res.json();
    credits = data.credits_remaining ?? credits;
    const list = itemsOf(data);
    if (page === 0) console.log("top-level keys:", Object.keys(data).join(", "));
    if (!list.length) { console.log(`page ${page}: 0 items — END`); break; }
    let pНewest: number | null = null, pOldest: number | null = null;
    for (const it of list) { const ms = tsOf(it); if (ms == null) continue; if (pНewest==null||ms>pНewest) pНewest=ms; if (pOldest==null||ms<pOldest) pOldest=ms; }
    total += list.length;
    if (pOldest != null && (oldest == null || pOldest < oldest)) oldest = pOldest;
    console.log(`page ${page}: items=${list.length} newest=${pНewest?day(pНewest):"?"} oldest=${pOldest?day(pOldest):"?"} cursor=${cursor}->${data.cursor ?? data.max_cursor}`);
    const next = data.cursor ?? data.max_cursor;
    if (next == null || String(next) === String(cursor)) { console.log("cursor stalled — END"); break; }
    cursor = next;
  }
  console.log(`\nTOTAL=${total} oldest=${oldest?day(oldest):"?"} (${oldest?Math.round((Date.now()-oldest)/86400000):"?"} days back) credits=${credits} ${(Date.now()-t0)/1000}s`);
}
main().catch((e) => { console.error(e); process.exit(1); });
