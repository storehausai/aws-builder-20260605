/**
 * Empirical depth probe: how far back can the ScrapeCreators TikTok keyword
 * search paginate, and at what cost? Answers whether "paginate all + filter by
 * date" can reach a burst window months in the past.
 */
const KEY = process.env.SCRAPECREATORS_API_KEY!;
const BASE = "https://api.scrapecreators.com";
const brand = process.argv[2] ?? "Cora";
const MAX_PAGES = Number(process.argv[3] ?? 30);

const decodeMs = (id: unknown): number | null => {
  const s = String(id ?? "");
  if (!/^\d+$/.test(s)) return null;
  try { return Number(BigInt(s) >> 32n) * 1000; } catch { return null; }
};
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function main() {
  let cursor = 0, total = 0, globalOldest: number | null = null, credits: number | undefined;
  const t0 = Date.now();
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ query: brand, sort_by: "date-posted", date_posted: "all-time", trim: "true", cursor: String(cursor) });
    const res = await fetch(`${BASE}/v1/tiktok/search/keyword?${params}`, { headers: { "x-api-key": KEY } });
    if (!res.ok) { console.log(`page ${page}: HTTP ${res.status} ${(await res.text()).slice(0,120)}`); break; }
    const data: any = await res.json();
    credits = data.credits_remaining ?? credits;
    const list: any[] = Array.isArray(data.search_item_list) ? data.search_item_list : [];
    if (list.length === 0) { console.log(`page ${page}: empty — END`); break; }
    let newest: number | null = null, oldest: number | null = null;
    for (const it of list) {
      const ms = decodeMs(it?.aweme_id);
      if (ms == null) continue;
      if (newest == null || ms > newest) newest = ms;
      if (oldest == null || ms < oldest) oldest = ms;
    }
    total += list.length;
    if (oldest != null && (globalOldest == null || oldest < globalOldest)) globalOldest = oldest;
    console.log(`page ${page}: items=${list.length} newest=${newest?day(newest):"?"} oldest=${oldest?day(oldest):"?"} cursor=${cursor}->${data.cursor}`);
    const next = Number(data.cursor);
    if (!Number.isFinite(next) || next === cursor) { console.log("cursor stalled — END"); break; }
    cursor = next;
  }
  const oldestDays = globalOldest ? Math.round((Date.now() - globalOldest) / 86400000) : null;
  console.log(`\nTOTAL items=${total} | oldest reached=${globalOldest?day(globalOldest):"?"} (${oldestDays} days back) | credits_remaining=${credits} | ${(Date.now()-t0)/1000}s`);
}
main().catch((e) => { console.error(e); process.exit(1); });
