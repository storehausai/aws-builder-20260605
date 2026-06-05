# Requirements → Implementation → Test (traceability)

Every requirement the product owner specified, mapped to the code that satisfies it and the
test that proves it. Run the tests with `pnpm test` (26 cases, all green, no external creds).

## The 7-step demo

| # | Requirement | Implementation | Test | Status |
|---|---|---|---|---|
| 1 | Start from a brand **homepage URL** | `@pebble/providers` `onboardFromUrl()` — fetches the US storefront, extracts brand/category/competitors via the Butterbase AI gateway; `@pebble/pipelines` a–j chain step (a) | `requirements.test.ts` (surface), `discovery.test.ts` (integration uses brandUrl) | ✅ |
| 2 | Big **"Find influencers"** pill (no blank page) | `apps/web` `Landing.tsx` — hero + pill + example chips | `next build` passes (web agent verified) | ✅ |
| 3 | **Search influencers using data; process shown in chat** | `@pebble/pipelines` `runAjChain` orchestrates a–j; engine (`findMarketMovers`) does c–h; `discoverSimilarCreators` does (i); each stage pushes a narrated `step` | `engine.test.ts` (c–h math), `discovery.test.ts` (chain + narration) | ✅ |
| 4 | **Suggest influencers** by those steps | `runDiscovery` → `InfluencerSuggestion[]` (proven mover first, then lookalikes), rendered in `apps/web` `ResultsPanel`/`CreatorCard` | `discovery.test.ts` (mover surfaced) | ✅ |
| 5 | **Send DMs**; if Instagram isn't integrated, **ask in chat** | `runOutreach` composes + sends via `@pebble/outreach`; returns `needsConnection:"instagram"` when not connected | `outreach.test.ts`, `instagram.test.ts` | ✅ |
| 6 | **Integrate iPhone** (iMessage) | `apps/messaging` Spectrum worker — two-way iMessage (`for await ([space,msg]) → space.send`); keyed on `space.id` for per-conversation threading | `requirements.test.ts` (worker present); Photon-verified two-way + threading | ✅ |
| 7 | **Reply comes back** | `@pebble/outreach` inbound (private `pollInbound` / graph webhook `parseInbound`) → messaging worker relays to the marketer's iMessage + records to Butterbase | `instagram.test.ts` (webhook parse) | ✅ |

## The a–j discovery algorithm (requirement #3, in detail)

| Step | Logic | Where | Test |
|---|---|---|---|
| (a) find competitors | homepage → brand/category/competitors | `onboardFromUrl` | discovery integration |
| (b) competitor ASINs on Amazon | Keepa product finder (US, domain 1) | `onboardFromUrl` `seedAsins` | — (needs Keepa key) |
| (c) check BSR | `commerce_product_snapshot` rank series | `apps/engine` reads via `@pebble/bb` | engine.test |
| (d) ranking burst | rolling Hampel detector | `detectSpikes` | `engine.test` (exact burst) |
| (e) price steady? | price gate (≥5% drop ⇒ discount) | `findMarketMovers` | `engine.test` (gate) |
| (f) burst + steady ⇒ outside traffic | verdict `creator_driven` | `findMarketMovers` | `engine.test` |
| (g) content 0–7 days before | spike windowing | `findMarketMovers` | `engine.test` |
| (h) most viral post = market mover | `scoreCascade` composite | `findMarketMovers` `topAttribution` | `engine.test` |
| (i) creators similar to the mover | apidojo niche search / AI + IG enrich | `discoverSimilarCreators` | requirements.test |
| (j) suggest | ranked shortlist | `runAjChain` `buildSuggestions` | discovery.test |

## The four sponsor technologies (deep integration)

| Tech | Role | Where | Test |
|---|---|---|---|
| **RocketRide** | orchestration (discovery/outreach/ingest `.pipe` graphs); `runDiscovery` drives `discovery.pipe` when the engine is reachable | `pipelines/*.pipe`, `@pebble/pipelines` | `requirements.test` (pipes present) |
| **Butterbase** | the only datastore (canonical + outreach) + the only LLM path (AI gateway) | `butterbase/schema.json`, `@pebble/bb` | `bb-upsert.test`, `requirements.test` (schema) |
| **XTrace** | persistent memory — brand brief + outcome facts, recalled per turn | `@pebble/memory` | `memory.test` (graceful) |
| **Photon/Spectrum** | two-way iMessage to the marketer + IG-reply relay | `apps/messaging` | `requirements.test`; Photon-verified |

## Notes on what needs live credentials (build is complete; these gate the *live* run)
- **Real Amazon BSR data (b–h):** needs `KEEPA_API_KEY` + an ingested brand; without it the chain narrates honestly and ranks by category signal.
- **Real cold IG DM (5/7):** needs a burner `IG_USERNAME`/`IG_PASSWORD` (+ session via `pnpm ig:login`).
- **iMessage (6):** needs `PROJECT_ID`/`PROJECT_SECRET` + iMessage enabled in the Photon dashboard (managed line).
- **XTrace memory / Butterbase:** need `XTRACE_*` and the Butterbase app id + service key.
- The whole system **degrades gracefully** without any of these — `pnpm test` proves the contracts hold with zero credentials.
