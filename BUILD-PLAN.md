# pebble (hackathon edition) — Build Plan

> **One line:** rebuild pebble's "find influencers who actually move the market, then reach out to
> them" loop on the hackathon stack — **RocketRide** (orchestration) · **Butterbase** (backend + AI
> gateway) · **XTrace** (memory) · **Photon/Spectrum** (messaging) — so a brand goes from *homepage
> URL* → *suggested influencers* → *real Instagram DM sent* → *reply relayed to their iPhone*.

_Plan authored 2026-06-05. Living document._

---

## 0. The demo (the spec everything serves)

The 7-step live demo, verbatim from the product owner:

1. **Start from a brand homepage URL.** Brand pastes e.g. `https://www.getrael.com`.
2. **A big pill: "Find influencers."** One prominent CTA.
3. **It searches influencers using data — the process is shown in the chat.** The agent's work
   (ingesting the brand, pulling category/competitor creators, scoring) streams live in chat.
4. **Suggest some influencers.** A ranked shortlist, each with why-this-creator evidence.
5. **Send DMs → ask for Instagram integration.** The marketer approves; the app asks the brand to
   connect Instagram (so DMs send *as the brand*).
6. **Ask for integrating iPhone.** Connect iMessage (Spectrum) so replies reach the marketer's phone.
7. **If the reply comes, done.** Influencer replies on Instagram → relayed to the marketer's
   iMessage. **The DM must really arrive** and a real reply must really come back.

### End-to-end runtime topology

```
 ┌───────────────────────────────────────────────────────────────────────────────┐
 │  WEB APP (Next.js, apps/web)  — homepage-URL front door + big pill + chat       │
 │     steps 1–4 happen here; the chat streams the agent's discovery work          │
 └───────────────┬───────────────────────────────────────────────────────────────┘
                 │ POST intent ("find influencers for <brandUrl>")
                 ▼
 ┌───────────────────────────── RocketRide ENGINE (:5565) ─────────────────────────┐
 │  discovery.pipe → agent_rocketride orchestrator                                 │
 │     control:llm    → Butterbase AI gateway (anthropic/claude-sonnet-4.6)        │
 │     control:memory → XTrace (brand brief + who we've contacted/who converted)   │
 │     control:tool   → ingest_brand · find_creators · score_movers · render_panel │
 │                                  · send_ig_dm  (outreach.pipe)                   │
 └───────┬───────────────────────────────────────────────┬─────────────────────────┘
         │ HTTP tool calls                                │ writes canonical + outcomes
         ▼                                                ▼
 ┌──────────────────────────┐                  ┌──────────────────────────────────┐
 │ ENGINE SVC (apps/engine) │                  │  Butterbase  (Postgres + auth +   │
 │  pure @pebble/engine math│                  │  storage + AI gateway)            │
 │  /market-movers /attribute                  │  canonical moat + outreach tables │
 └──────────────────────────┘                  └──────────────────────────────────┘
         ▲ reads canonical                                ▲
         │                                                │
 ┌──────────────────────────┐     ┌──────────────────────────────────────────────┐
 │ @pebble/providers        │     │  Photon / Spectrum worker  (apps/messaging)    │
 │  Keepa · Apify ·         │     │  for await ([space,msg] of app.messages){...}  │
 │  ScrapeCreators (read)   │     │  providers: [ imessage(), instagram(custom) ]  │
 └──────────────────────────┘     │   • agent→influencer : Instagram DM (send)     │
                                  │   • influencer→agent : Instagram DM (reply)    │
                                  │   • agent→marketer   : iMessage (relay reply)  │
                                  └────────────────────────────────────────────────┘
```

**Why this satisfies "deep integration" of all four (anti-disqualification):**

| Service | Load-bearing role (remove it → product breaks) |
|---|---|
| **RocketRide** | The *only* orchestrator. Every discovery run and every outreach action is a `.pipe`. |
| **Butterbase** | The *only* datastore (canonical moat + outreach) **and** the *only* LLM path (gateway). |
| **XTrace** | Read every turn (brand brief, proven movers, prior contacts), written on every send/reply/outcome. It's what makes "who actually converts for me" compound. |
| **Photon** | Real two-sided messaging fabric: sends the IG DM *and* relays the reply to iMessage. Step 5–7 literally are Photon. |

---

## 1. The Instagram-DM reality (decide this first — it gates the demo)

**Constraint.** Meta's official **Instagram Messaging API** (Graph API, `instagram_manage_messages`)
only permits a business to **reply within 24h after the user DMs first**. It cannot send a cold DM to
an arbitrary influencer. It also requires an IG Business/Creator account linked to a Facebook Page
plus app review — none of which yields cold outreach.

**Therefore, to make a cold DM *really arrive*, the realistic mechanism is the unofficial private API:**

- **Library:** [`instagram-private-api`](https://github.com/dilame/instagram-private-api) (Node) —
  `ig.entity.directThread([userPk]).broadcastText(msg)` sends a DM as a logged-in account; cold DMs
  land in the recipient's **Message Requests** folder (still delivered). Inbound replies via inbox
  polling or the realtime (MQTT) client.
- **"Connect Instagram" (step 5)** = brand provides credentials for a **dedicated sending account**
  (ideally a burner/brand account), which we log in once and **serialize the session state** so the
  demo doesn't re-trigger a login checkpoint.

> ⚠️ **Risk to accept explicitly:** this violates Instagram's ToS and the sending account can be
> checkpointed/banned. Mitigations: use a burner brand account, pre-establish + persist the session
> before the demo, throttle sends, run behind a residential proxy, keep volume tiny (the demo sends
> 1–3 DMs). **Do not use a real valuable account.**

**Fallback / "compliant mode"** (if we don't want ToS risk in the room): pre-seed the demo by having
the "influencer" (a teammate's IG) DM the brand account first, opening the 24h window, then use the
**official** API to reply — fully legitimate, but it's not true cold outreach. We build the provider
behind a `definePlatform` interface so either backend (unofficial / official) plugs in unchanged.

**Decision needed from owner:** unofficial (true cold, ToS risk) — *recommended for the demo* — vs.
compliant pre-window. The plan below assumes **unofficial via a custom Spectrum provider**, isolated
so swapping is a one-file change.

---

## 2. Stack mapping (pebble → hackathon stack)

| pebble today | Re-architected |
|---|---|
| `supabase/migrations/*.sql` (19 canonical tables) | **Butterbase** declarative `schema.json` (same tables; `provider_id` open-provenance ports verbatim) + new outreach tables |
| `@pebble/db` (`@supabase/supabase-js`) | **`@pebble/bb`** (`@butterbase/sdk`) — near-identical `.from().select().eq()` surface |
| `apps/web/lib/ai.ts` (Vertex/AIStudio/Anthropic, ~200 lines) | **deleted** → Butterbase AI gateway (OpenAI-compatible, `provider/model`) |
| `apps/web/lib/chat-agent/loop.ts` (hand-coded Gemini loop) | **deleted** → RocketRide `discovery.pipe` (`agent_rocketride`); app calls `client.chat()` |
| `apps/web/lib/chat-agent/tools.ts` (3 tool decls) | RocketRide `tool_*` nodes on the orchestrator |
| `@pebble/engine` (pure TS math) | **unchanged** — exposed via `apps/engine` HTTP service, called as a `tool_http_request` node |
| `@pebble/providers` (Keepa/Apify/ScrapeCreators) | **kept**; invoked by RocketRide ingestion-pipeline tool nodes |
| `@pebble/panels` | unchanged (panel iframe stays for web) |
| *(missing: feedback loop / outreach memory)* | **`@pebble/memory`** (`@xtraceai/memory`) |
| *(missing: outreach + messaging)* | **`apps/messaging`** (Spectrum worker) + **`@pebble/outreach`** (IG sender + relay) |

### New monorepo shape

```
pebble-hackathon/  (pnpm + Turbo)
├── apps/
│   ├── web/              # Next.js — homepage-URL front door, big pill, streaming chat, panel iframe
│   ├── engine/           # NEW — tiny HTTP wrapper around @pebble/engine (/market-movers, /attribute)
│   └── messaging/        # NEW — Spectrum worker: iMessage(marketer) + Instagram(custom provider)
├── packages/
│   ├── core/             # types + ports                       (unchanged)
│   ├── engine/           # detectSpikes/scoreCascade/findMarketMovers  (UNCHANGED — the moat)
│   ├── providers/        # Keepa/Apify/ScrapeCreators adapters  (kept)
│   ├── panels/           # UI components                        (unchanged)
│   ├── bb/               # NEW — @pebble/bb: Butterbase client (replaces @pebble/db)
│   ├── memory/           # NEW — @pebble/memory: XTrace brand-brief + outcomes wrapper
│   └── outreach/         # NEW — @pebble/outreach: IG provider (definePlatform) + relay logic
├── pipelines/            # NEW — RocketRide .pipe graphs (committed to git)
│   ├── ingest.pipe       #   provider fetch → adapter.normalize → Butterbase write
│   ├── discovery.pipe    #   orchestrator: ingest_brand → find_creators → score → suggest
│   └── outreach.pipe     #   compose DM → send_ig_dm → record thread → notify marketer
└── butterbase/
    └── schema.json       # canonical + outreach schema
```

---

## 3. Butterbase schema (`butterbase/schema.json`)

Port pebble's canonical tables 1:1 (Butterbase is Postgres; the DDL maps directly to declarative
JSON). Keep these from pebble unchanged in shape:

- **Moat / canonical:** `data_provider`, `commerce_fetch_raw`, `commerce_product`,
  `commerce_product_snapshot`, `social_fetch_raw`, `social_account`, `social_account_post`,
  `social_account_snapshot`, `social_post_snapshot`, `brand`, `brand_account`, `brand_mention`,
  `tracked_brand`, `detected_event`, `attribution`, `panels`.
- **Tenancy:** `stores`, `store_members`, `requests` (intake/conversation). Auth via Butterbase Auth
  (email/magic-link/OAuth) replacing Supabase Auth.

**New tables for the homepage→outreach flow:**

```jsonc
{
  "brand_profile": {            // step 1: extracted from the homepage URL
    "columns": {
      "id":            { "type": "uuid", "primary": true, "default": "gen_random_uuid()" },
      "store_id":      { "type": "uuid", "nullable": false },
      "homepage_url":  { "type": "text", "nullable": false },
      "name":          { "type": "text" },
      "category":      { "type": "text" },
      "summary":       { "type": "text" },         // LLM-extracted brand brief (also stored in XTrace)
      "seed_asins":    { "type": "jsonb" },
      "competitors":   { "type": "jsonb" },
      "created_at":    { "type": "timestamptz", "default": "now()" }
    }
  },
  "influencer_candidate": {      // step 4: a suggested creator for a brand
    "columns": {
      "id":            { "type": "uuid", "primary": true, "default": "gen_random_uuid()" },
      "store_id":      { "type": "uuid", "nullable": false },
      "platform":      { "type": "text", "default": "'instagram'" },
      "handle":        { "type": "text", "nullable": false },
      "platform_pk":   { "type": "text" },         // IG numeric user id (for DM send)
      "followers":     { "type": "int8" },
      "score":         { "type": "float8" },        // cascade / market-mover composite
      "rationale":     { "type": "text" },          // why-this-creator
      "status":        { "type": "text", "default": "'suggested'" }, // suggested|approved|contacted|replied
      "created_at":    { "type": "timestamptz", "default": "now()" }
    }
  },
  "outreach_thread": {           // step 5–7: one conversation with one influencer
    "columns": {
      "id":            { "type": "uuid", "primary": true, "default": "gen_random_uuid()" },
      "candidate_id":  { "type": "uuid", "nullable": false },
      "store_id":      { "type": "uuid", "nullable": false },
      "ig_thread_id":  { "type": "text" },
      "state":         { "type": "text", "default": "'sent'" },      // sent|delivered|replied|closed
      "marketer_imsg": { "type": "text" },          // marketer's iMessage handle for relay
      "created_at":    { "type": "timestamptz", "default": "now()" }
    }
  },
  "outreach_message": {          // every DM in/out (the proof the DM arrived + reply came)
    "columns": {
      "id":            { "type": "uuid", "primary": true, "default": "gen_random_uuid()" },
      "thread_id":     { "type": "uuid", "nullable": false },
      "direction":     { "type": "text", "nullable": false },        // outbound|inbound
      "channel":       { "type": "text", "nullable": false },        // instagram|imessage
      "body":          { "type": "text" },
      "sent_at":       { "type": "timestamptz", "default": "now()" }
    }
  }
}
```

Apply with `POST /v1/{app_id}/schema/apply` (use `dry_run: true` first). RLS: `store_id`-scoped.

---

## 4. RocketRide pipelines (`pipelines/*.pipe`)

All three are JSON graphs authored in the VS Code extension and committed. The app/worker just
`client.use({filepath})` then `client.chat()/send()`.

### 4.1 `ingest.pipe` — data in (webhook source)
`webhook → tool_fetch (provider) → tool_normalize (adapter) → tool_bb_write (Butterbase)`. One run
per (capability, ref). The fetch/normalize tools are HTTP nodes hitting `apps/engine` or small route
handlers that reuse `@pebble/providers` adapters unchanged.

### 4.2 `discovery.pipe` — steps 1–4 (chat source, the demo's spine)
```jsonc
{ "source": "chat_1", "components": [
  { "id": "chat_1", "provider": "chat", "config": { "mode": "Source" } },
  { "id": "agent", "provider": "agent_rocketride",
    "config": { "max_waves": 14, "instructions": [
      "You are Pebble, an influencer-marketing copilot. Given a brand homepage URL, (1) ingest the brand,",
      "(2) find candidate creators in its category/among competitor mentions, (3) score them by proven",
      "market impact, (4) suggest a ranked shortlist with a one-line rationale each. Narrate each step so",
      "the user sees the work. Be honest: correlation ≠ causation." ] },
    "input": [{ "lane": "questions", "from": "chat_1" }] },

  { "id": "llm", "provider": "llm_openai",
    "config": { "baseURL": "https://api.butterbase.ai/v1", "model": "anthropic/claude-sonnet-4.6",
                "apikey": "${ROCKETRIDE_BUTTERBASE_KEY}" },
    "control": [{ "classType": "llm", "from": "agent" }] },
  { "id": "mem", "provider": "memory_xtrace",
    "config": { "apiKey": "${XTRACE_API_KEY}", "orgId": "${XTRACE_ORG_ID}" },
    "control": [{ "classType": "memory", "from": "agent" }] },

  { "id": "t_ingest",  "provider": "tool_http_request", "config": { "url": "${WEB_URL}/api/tools/ingest-brand" },
    "control": [{ "classType": "tool", "from": "agent" }] },
  { "id": "t_find",    "provider": "tool_http_request", "config": { "url": "${WEB_URL}/api/tools/find-creators" },
    "control": [{ "classType": "tool", "from": "agent" }] },
  { "id": "t_score",   "provider": "tool_http_request", "config": { "url": "${ENGINE_URL}/market-movers" },
    "control": [{ "classType": "tool", "from": "agent" }] },
  { "id": "t_panel",   "provider": "tool_http_request", "config": { "url": "${WEB_URL}/api/generate-panel" },
    "control": [{ "classType": "tool", "from": "agent" }] },

  { "id": "out", "provider": "response_answers", "config": { "laneName": "answers" },
    "input": [{ "lane": "answers", "from": "agent" }] }
] }
```
Streaming the agent's wave events into chat (step 3) uses `client.setEvents()/onEvent`.

### 4.3 `outreach.pipe` — steps 5–7 (invoked when the marketer approves)
`agent` composes a personalized DM per approved candidate → calls **`send_ig_dm`** tool (HTTP node →
`@pebble/outreach` send) → writes `outreach_thread`/`outreach_message` to Butterbase → calls
**`notify_marketer`** tool (relay a "DM sent to @handle" card to iMessage). Replies are pushed in by
the Spectrum worker (§6), not pulled by the pipeline.

---

## 5. XTrace memory (`@pebble/memory`)

`createClient` → `@xtraceai/memory` (`MemoryClient({apiKey, orgId})`). Scope by `user_id = store_id`,
`conv_id = request/thread id`. We use it three ways:

1. **Brand brief (write on step 1).** After extracting the homepage, `ingest({messages:[{role:'user',
   content:'Brand <name> sells <category>; flagship ASINs ...; competitors ...'}], user_id})`. The
   agent `recall()`s this on every later turn so it never re-derives the brand.
2. **Outcome facts (write on steps 5–7).** "Contacted @handle for <brand> on <date>"; on reply,
   "@handle replied — interested." These compound into the moat pebble's VISION §3 always wanted.
3. **Belief revision (free).** If a creator first looks like a market-mover but later data shows the
   spike was a discount, ingesting the corrected fact lets XTrace supersede the old belief — so
   "who actually converts for me" stays honest over time.

Wired into RocketRide as the `memory_xtrace` control node; also available to the web app directly via
the SDK for the brand-brief write.

---

## 6. Photon / Spectrum (`apps/messaging` + `@pebble/outreach`)

One long-lived worker process. `Spectrum({ projectId, projectSecret, providers: [ imessage.config(),
instagramProvider.config({...}) ] })`, then the canonical loop:

```ts
for await (const [space, message] of app.messages) {
  if (message.platform === "instagram" && message.content.type === "text") {
    // influencer replied → persist + relay to the marketer's iMessage (step 7)
    await recordInbound(message);
    const marketer = await marketerSpaceFor(message);      // resolve iMessage handle from outreach_thread
    await marketer.send(`📩 ${message.sender.id} replied:\n"${message.content.text}"`);
  }
  if (message.platform === "iMessage") {
    // marketer talks to the agent over iMessage → run discovery.pipe, reply with the result
    const answer = await runDiscovery(message.content.text);
    await space.send(answer);
  }
}
```

- **iMessage** = Spectrum's shipping provider. Locally (we're on macOS) via
  [`imessage-kit`](https://github.com/photon-hq/imessage-kit): reads `~/Library/Messages/chat.db`
  (WAL watcher) + sends via AppleScript. **"Integrate iPhone" (step 6)** = grant the terminal Full
  Disk Access + Messages signed in. (Spectrum Cloud number is the no-Mac alternative.)
- **Instagram** = **custom provider via `definePlatform`** in `@pebble/outreach`, backed by
  `instagram-private-api` (§1). It implements: an inbound async stream (poll/realtime IG inbox →
  yield `{space, message}`) and `space.send(text)` → `directThread.broadcastText`. Because it's a
  Spectrum provider, the influencer's reply flows through the *same* `app.messages` loop and is
  trivially relayed to iMessage.
- **Outbound send tool** (`send_ig_dm`, called by `outreach.pipe`) and the worker share the same
  `@pebble/outreach` IG client/session.

**Panel-over-messaging adaptation:** iMessage can't render the HTML panel. The agent sends a concise
text brief + the panel as a **hosted link** (panel HTML uploaded to **Butterbase storage**, public
URL) and/or a rendered **screenshot image** (`space.send(attachment(png))`). Web keeps the live
iframe.

---

## 7. The engine HTTP service (`apps/engine`) — decided: HTTP tool node

A ~50-line server (Hono/Express on Fluid Compute or local) importing `@pebble/engine` **verbatim**:

```ts
// POST /market-movers { storeId, scope, identifier } -> findMarketMovers(...) over Butterbase data
// POST /attribute     { storeId, scope, identifier, eventId? } -> spike-window content attribution
```
It reads canonical data from Butterbase (`@pebble/bb`), runs the pure math, returns JSON. RocketRide
calls it as `tool_http_request`. This keeps pebble's cardinal rule intact: **the engine imports
nothing**, math stays identical to the TS original (no numerical drift), and RocketRide stays the
orchestrator. `${ENGINE_URL}` is the only new env coupling.

---

## 8. Web app changes (`apps/web`)

- **Front door (step 1–2):** a homepage-URL input + one big **"Find influencers"** pill on the chat
  landing. Submitting posts `{ brandUrl }` and opens the chat.
- **Streaming the process (step 3):** subscribe to RocketRide `onEvent` and render each wave/tool
  step as a chat status line ("Ingesting getrael.com…", "Pulling 40 skincare creators…", "Scoring by
  proven impact…"). Reuse the existing SSE chat contract in `lib/chat-mock` / the stream route.
- **Suggestions (step 4):** a `creators` panel (already exists in `@pebble/panels`) with an
  **Approve & DM** action per creator → triggers `outreach.pipe`.
- **Integration prompts (steps 5–6):** "Connect Instagram" and "Connect iPhone" modals that capture
  the IG session + confirm the iMessage worker is live.
- **Delete** `lib/ai.ts` and `lib/chat-agent/loop.ts`; replace their call sites with the RocketRide
  client + Butterbase gateway.

---

## 9. Environment variables

```bash
# RocketRide
ROCKETRIDE_APIKEY=...                 # or local Docker engine on :5565
ROCKETRIDE_BUTTERBASE_KEY=bb_sk_...   # the gateway key the llm_openai node uses
ENGINE_URL=http://localhost:8787
WEB_URL=http://localhost:3000

# Butterbase (DB + auth + storage + AI gateway)
NEXT_PUBLIC_BUTTERBASE_APP_ID=app_...
NEXT_PUBLIC_BUTTERBASE_API_URL=https://api.butterbase.ai
BUTTERBASE_SERVICE_KEY=bb_sk_...

# XTrace
XTRACE_API_KEY=xtk_...
XTRACE_ORG_ID=...

# Photon / Spectrum
PROJECT_ID=...
PROJECT_SECRET=...

# Instagram (custom provider) — dedicated/burner brand account
IG_USERNAME=...
IG_PASSWORD=...
IG_SESSION_PATH=./.ig-session.json    # serialized session to avoid login checkpoints in the demo
IG_PROXY=...                          # optional residential proxy

# Data providers (unchanged from pebble)
KEEPA_API_KEY=...  APIFY_TOKEN=...  SCRAPECREATORS_API_KEY=...
```

---

## 10. Build sequence (thin vertical slice first)

Order chosen so the **riskiest, must-really-work** piece (a real IG DM + reply relay) is proven
earliest, then the rest is assembled around it.

**Milestone A — "a real DM arrives" (de-risk first).**
1. `@pebble/outreach`: log in with `instagram-private-api`, serialize session, send one DM to a test
   IG account, poll for the reply. Prove it end-to-end from a script.
2. Wrap it as a Spectrum `definePlatform` provider; prove the reply surfaces in `app.messages`.
3. `apps/messaging`: add `imessage` provider (imessage-kit, Full Disk Access); relay the IG reply to
   your own iMessage. **Steps 5–7 now work in isolation.**

**Milestone B — backend on Butterbase.**
4. Create the Butterbase app; apply `butterbase/schema.json` (canonical + outreach). `@pebble/bb`
   client; port `@pebble/db` call sites.
5. Point an OpenAI client at the Butterbase gateway; delete `lib/ai.ts`. Confirm a Claude/Gemini call.

**Milestone C — RocketRide orchestration.**
6. Stand up the engine HTTP service (`apps/engine`) over `@pebble/engine` + Butterbase reads.
7. Author `ingest.pipe` + `discovery.pipe` in the VS Code extension; run the engine via Docker
   (`:5565`); invoke from a script (`client.use → chat`). Wire `memory_xtrace` + Butterbase gateway.
8. Author `outreach.pipe`; its `send_ig_dm`/`notify_marketer` tools call Milestone-A code.

**Milestone D — web glue + demo polish.**
9. Homepage-URL front door + big pill; stream `onEvent` into chat (step 3); `creators` panel with
   Approve & DM; "Connect Instagram"/"Connect iPhone" modals.
10. XTrace brand-brief write on ingest; outcome writes on send/reply.
11. Dry-run the full 7-step demo; pre-establish the IG session; rehearse.

---

## 11. Open decisions / risks (track these)

- **IG mechanism (§1):** unofficial cold (recommended for demo, ToS/ban risk) vs. compliant pre-window.
  *Owner decision pending.* Build behind `definePlatform` so it's swappable.
- **IG login fragility:** checkpoints/2FA can block a fresh login mid-demo → **pre-serialize the
  session**, use a burner account + proxy, keep volume tiny.
- **iMessage requires a Mac** with Full Disk Access (we have one) or a Spectrum Cloud number.
- **RocketRide node availability:** confirm a `memory_xtrace` node exists (the examples repo ships
  `xtrace-memory-agent.pipe`); if not, attach XTrace as a `tool_*` (search_memory/save_memory) node
  instead — same effect.
- **Butterbase gateway model IDs:** verify `anthropic/claude-sonnet-4.6` is live via
  `GET /v1/public/models`; fall back to an available ID.
- **Discovery vs. attribution framing:** the demo's "find influencers" is forward-looking discovery;
  pebble's engine ranks by *proven past* impact. Where a brand is new (no history), rank by
  category/competitor-mention signal and label it as such — stay honest.
```
