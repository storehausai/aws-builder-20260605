/**
 * Storefront onboarding — steps (a) + (b) of the influencer-discovery flow.
 *
 * Given a brand homepage URL, produce a `BrandOnboarding`: the brand name,
 * category, a short brief, likely US competitors, and (best-effort) seed Amazon
 * ASINs. This kicks the flow off: competitors → competitor ASINs → the engine's
 * BSR-burst / market-mover scan happens downstream.
 *
 * Design rule for this file: NEVER throw. Every failure path (fetch error,
 * JS-only page, AI hiccup, bad JSON, Keepa miss) degrades to a still-useful
 * `BrandOnboarding` — at worst `{ brand: <domain>, category: "", competitors: [],
 * seedAsins: [], ... }`. The caller can always rely on getting an object back.
 *
 * Mechanism:
 *   1. fetch(url) the homepage HTML with a browser UA, following redirects, and
 *      cap the body so a giant page can't blow up memory / the model context.
 *   2. Ask the Butterbase AI gateway to extract brand + category + summary +
 *      US competitors as STRICT JSON; parse defensively.
 *   3. If KEEPA_API_KEY is present, best-effort resolve the brand to seed ASINs
 *      via the Keepa Product Finder (reusing the keepa adapter's auth/host).
 *      Otherwise seedAsins is [].
 *
 * US storefronts only — we never resolve Korean-market paths here.
 */

import { createBb, chatText } from "@pebble/bb";
import { createKeepaAdapter } from "./keepa.js";

/* -------------------------------- types -------------------------------- */

export interface BrandOnboarding {
  brand: string;
  category: string; // e.g. "skincare", "supplements"
  summary: string; // 1–2 sentence brand brief
  competitors: string[]; // competitor brand names (US market)
  seedAsins: string[]; // Amazon ASINs if resolvable, else []
  homepageUrl: string;
}

/* ------------------------------ constants ------------------------------ */

/** A real browser UA — some storefronts 4xx/serve junk to bot-looking UAs. */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Cap the homepage fetch so a huge page can't blow up memory/model context. */
const MAX_BODY_BYTES = 600_000;
/** Cap how much page TEXT we hand the model (post strip). */
const MAX_TEXT_CHARS = 12_000;
/** Bound the homepage fetch so a hung server can't stall onboarding. */
const FETCH_TIMEOUT_MS = 15_000;

/* ------------------------------- helpers ------------------------------- */

/** Ensure the URL has a scheme so `new URL` / fetch accept it. */
function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Pull a clean domain ("acme") from a URL, for the worst-case brand fallback. */
function domainFromUrl(url: string): string {
  try {
    const host = new URL(normalizeUrl(url)).hostname.replace(/^www\./, "");
    // "acme.com" → "acme"; multi-label hosts keep the leading label.
    const label = host.split(".")[0] ?? host;
    return label || host || url;
  } catch {
    // Not a parseable URL — strip scheme/path roughly and return what's left.
    return (
      url
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "")
        .split(/[/?#]/)[0]
        ?.split(".")[0] ?? url
    );
  }
}

/** Sleep helper for the single AI retry (no foreground-blocking spin). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Strip HTML down to a rough text approximation: drop script/style blocks and
 * tags, collapse whitespace, and cap length. Good enough to feed the model the
 * brand's own words without shipping markup noise. We also lift the <title> and
 * meta description / og:site_name, which are high-signal for brand + category.
 */
function htmlToText(html: string): string {
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const metaDesc =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(
      html,
    )?.[1] ?? "";
  const ogSite =
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["']/i.exec(
      html,
    )?.[1] ?? "";
  const body = noScript
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  const text = [ogSite, title, metaDesc, body].filter(Boolean).join("\n");
  return text.slice(0, MAX_TEXT_CHARS);
}

/**
 * Fetch the homepage HTML, following redirects, with a browser UA and a size +
 * time cap. Returns the (capped) HTML string, or null on any failure — the
 * caller falls back to domain-only inference, so we never throw here.
 */
async function fetchHomepageHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(normalizeUrl(url), {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": USER_AGENT,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return null;
    // Stream-read up to MAX_BODY_BYTES so a giant page can't exhaust memory.
    const body = res.body;
    if (!body) {
      const full = await res.text();
      return full.slice(0, MAX_BODY_BYTES);
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let out = "";
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        out += decoder.decode(value, { stream: true });
        if (received >= MAX_BODY_BYTES) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
    }
    out += decoder.decode();
    return out;
  } catch {
    // Network error, abort/timeout, JS-only page that hangs — all non-fatal.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ----------------------------- AI extraction --------------------------- */

interface ExtractedBrand {
  brand: string;
  category: string;
  summary: string;
  competitors: string[];
}

const EXTRACT_SYSTEM =
  "You are a US market analyst onboarding a consumer brand for an " +
  "influencer-discovery tool. Given a brand homepage's text (or, if the page " +
  "is JS-only/empty, just its domain), infer the brand identity and its most " +
  "likely US-market competitors. Focus on US storefronts and US-sold brands " +
  "only — never non-US / Korean-market brands. Respond with STRICT JSON ONLY, " +
  "no prose, no markdown fences, matching exactly: " +
  '{"brand": string, "category": string, "summary": string, "competitors": string[]}. ' +
  '"category" is a short lowercase noun like "skincare" or "supplements". ' +
  '"summary" is 1-2 sentences. "competitors" is up to 8 US competitor brand ' +
  "names (strings only). If you cannot tell, use your best guess from the " +
  "domain name; never leave brand empty.";

/** Pull the first JSON object out of a model reply, tolerating fences/prose. */
function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  // Strip ```json ... ``` fences if present.
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  // Fast path: the whole thing is JSON.
  try {
    return JSON.parse(unfenced);
  } catch {
    // Fall through to brace-matching extraction.
  }
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

/** Coerce an unknown into a trimmed, deduped string array (max 8 names). */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Ask the model to extract the brand fields. Returns a partially-filled
 * ExtractedBrand on success, or null on any failure (no bb config, AI error,
 * unparseable reply) — the caller fills in domain-based fallbacks.
 */
async function extractBrand(
  url: string,
  pageText: string | null,
): Promise<ExtractedBrand | null> {
  let bb: ReturnType<typeof createBb>;
  try {
    bb = createBb();
  } catch {
    // BUTTERBASE_APP_ID not configured — no AI path available.
    return null;
  }

  const domain = domainFromUrl(url);
  const userPrompt = pageText
    ? `Homepage URL: ${url}\nDomain: ${domain}\n\nHomepage text:\n${pageText}`
    : `Homepage URL: ${url}\nDomain: ${domain}\n\n(The homepage HTML could not ` +
      `be read — it may be JS-only or unreachable. Infer the brand and its US ` +
      `competitors from the domain name alone.)`;

  let reply: string;
  try {
    reply = await chatText(bb, EXTRACT_SYSTEM, userPrompt);
  } catch {
    return null;
  }

  const parsed = extractJsonObject(reply);
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const brand = typeof obj.brand === "string" ? obj.brand.trim() : "";
  const category = typeof obj.category === "string" ? obj.category.trim() : "";
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  const competitors = toStringArray(obj.competitors);

  // brand is the one field we really need; if the model left it blank, signal
  // failure so the caller can fall back to the domain.
  if (!brand) return null;

  return { brand, category, summary, competitors };
}

/* --------------------------- seed ASIN resolve ------------------------- */

/**
 * Best-effort: resolve the brand to a handful of US Amazon ASINs via the Keepa
 * Product Finder. Returns [] on any failure or when KEEPA_API_KEY is absent —
 * seed ASINs are a nice-to-have, never required.
 */
async function resolveSeedAsins(
  brand: string,
  env: Record<string, string | undefined>,
): Promise<string[]> {
  const keepaKey = env.KEEPA_API_KEY?.trim();
  if (!keepaKey || !brand) return [];
  try {
    // domain 1 = amazon.com (US). We never use a Korean-market domain here.
    const keepa = createKeepaAdapter(keepaKey, 1);
    const results = await keepa.resolveBrand(brand, 10);
    const asins: string[] = [];
    const seen = new Set<string>();
    for (const r of results) {
      const asin = r.asin?.trim();
      if (!asin || seen.has(asin)) continue;
      seen.add(asin);
      asins.push(asin);
    }
    return asins;
  } catch {
    return [];
  }
}

/* ------------------------------- public -------------------------------- */

/**
 * Onboard a brand from its homepage URL. Steps (a) competitors + (b) seed ASINs.
 *
 * NEVER throws — always resolves to a `BrandOnboarding`. On total failure the
 * result is `{ brand: <domain>, category: "", summary: "", competitors: [],
 * seedAsins: [], homepageUrl }`.
 *
 * @param url the brand's homepage URL (scheme optional — we normalize it).
 */
export async function onboardFromUrl(url: string): Promise<BrandOnboarding> {
  const homepageUrl = normalizeUrl(url);
  const domain = domainFromUrl(url);

  // (1) fetch the homepage; null if unreachable / JS-only — that's fine, the
  //     model can infer from the domain.
  const html = await fetchHomepageHtml(homepageUrl);
  const pageText = html ? htmlToText(html) : null;

  // (2) AI extraction (defensive). Retry once on a transient miss before
  //     falling back to a domain-only onboarding.
  let extracted = await extractBrand(homepageUrl, pageText);
  if (!extracted) {
    await sleep(400);
    extracted = await extractBrand(homepageUrl, pageText);
  }

  const brand = extracted?.brand ?? domain;
  const category = extracted?.category ?? "";
  const summary = extracted?.summary ?? "";
  const competitors = extracted?.competitors ?? [];

  // (3) best-effort seed ASINs (US Amazon via Keepa, if a key is present).
  const seedAsins = await resolveSeedAsins(brand, process.env);

  return {
    brand,
    category,
    summary,
    competitors,
    seedAsins,
    homepageUrl,
  };
}
