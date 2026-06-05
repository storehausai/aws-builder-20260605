/**
 * Live test of apidojo~tiktok-scraper SEARCH mode — can we get timestamped posts
 * across months that we can client-filter to a burst window [D-7, D]?
 */
const TOKEN = process.env.APIFY_TOKEN!;
const ACTOR = "apidojo~tiktok-scraper";
const URL = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${TOKEN}&timeout=120`;

const brand = process.argv[2] ?? "Rael";
const input = {
  keywords: [brand],
  dateRange: "LAST_SIX_MONTHS",
  sortType: "RELEVANCE",
  maxItems: 40,
  location: "US",
  shouldDownloadVideos: false,
  shouldDownloadCovers: false,
};

const tsOf = (it: any): number | null => {
  for (const k of ["createTimeISO", "uploadedAtFormatted", "createTime", "postedAtTimestamp", "create_time"]) {
    const v = it?.[k];
    if (typeof v === "string" && /\d{4}-\d{2}/.test(v)) return Date.parse(v);
    if (typeof v === "number" && v > 1e9) return v < 1e12 ? v * 1000 : v;
  }
  return null;
};
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function main() {
  const t0 = Date.now();
  console.log(`POST ${ACTOR} keywords=[${brand}] dateRange=LAST_SIX_MONTHS maxItems=40`);
  const res = await fetch(URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  console.log(`HTTP ${res.status} in ${(Date.now() - t0) / 1000}s`);
  if (!res.ok) { console.log((await res.text()).slice(0, 400)); return; }
  const items: any[] = await res.json();
  console.log(`items: ${items.length}`);
  if (!items.length) return;
  console.log("first item keys:", Object.keys(items[0]).slice(0, 30).join(", "));
  const dated = items.map((it) => ({ ms: tsOf(it), author: it.authorMeta?.name ?? it.author?.uniqueId ?? it["channel"]?.username ?? it.authorName, play: it.playCount ?? it.views ?? it.diggCount, desc: (it.text ?? it.desc ?? "").slice(0, 50) }))
    .filter((x) => x.ms);
  dated.sort((a, b) => b.ms! - a.ms!);
  const span = dated.length ? `${day(Math.min(...dated.map(d=>d.ms!)))} → ${day(Math.max(...dated.map(d=>d.ms!)))}` : "n/a";
  console.log(`dated items: ${dated.length} | span: ${span}`);
  for (const d of dated.slice(0, 8)) console.log(`  ${day(d.ms!)} @${d.author} play=${d.play} "${d.desc}"`);
}
main().catch((e) => { console.error(e); process.exit(1); });
