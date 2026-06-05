# @pebble/pipelines

The **orchestration layer** for pebble (hackathon edition). It wraps **RocketRide**
(the authored `.pipe` graphs in the repo-root [`pipelines/`](../../pipelines)) and
exposes a small, stable API to the web app and the Spectrum messaging worker.

## Public API

```ts
import {
  runDiscovery,
  runOutreach,
  createRocketRideClient,
  type DiscoveryResult,
  type OutreachResult,
  type InfluencerSuggestion,
} from "@pebble/pipelines";
```

### `runDiscovery(input): Promise<DiscoveryResult>`

`input: { text: string; brandUrl?: string; storeId?: string }`

Steps 1–4 of the demo: brand URL → suggested influencers. Returns:

```ts
interface DiscoveryResult {
  reply: string;                       // agent prose for the chat
  steps: string[];                     // narrated work (the demo's step 3)
  influencers: InfluencerSuggestion[]; // ranked shortlist with rationale
}
```

### `runOutreach(input): Promise<OutreachResult>`

`input: { handle: string; draft?: string; brand?: string; storeId?: string }`

Steps 5–7: composes a short personalized DM and sends it for real. Returns:

```ts
interface OutreachResult {
  ok: boolean;
  channel: "instagram";
  handle: string;
  message: string;     // the composed DM (sent or not)
  delivered: boolean;  // true only when the IG send actually succeeded
  threadId?: string;
  error?: string;
}
```

### `createRocketRideClient()`

A thin wrapper over `RocketRideClient`: `connect`, `use(filepath)`,
`useDiscoveryPipe()`, `useOutreachPipe()`, `chat(token, text)`, `isReachable()`,
`disconnect()`, plus `raw()` for the underlying SDK client.

## Primary / fallback behavior

Both entry points are designed to **never throw** and to always return a usable
result, so the live demo works whether or not a RocketRide engine is running.

### `runDiscovery`

| Path | When | What runs |
|---|---|---|
| **Primary** | RocketRide engine reachable (`ROCKETRIDE_URI` / `ROCKETRIDE_APIKEY`, or local Docker on `:5565`) | Loads `pipelines/discovery.pipe` via `client.use({ filepath })`, drives the `agent_rocketride` orchestrator with `client.chat(...)`, streams wave/tool events into `steps`, and parses the answer into a `DiscoveryResult`. |
| **Fallback** | engine **not** reachable | In-process discovery on the **Butterbase AI gateway** (`@pebble/bb` `chatText`): the model acts as Pebble and **proposes** influencer handles + rationale (resolving real follower counts is out of scope here). |
| **Last resort** | even the AI call fails | A small built-in sample of plausible influencers, so the web demo still renders. |

### `runOutreach`

1. Compose a short DM via `chatText` (Butterbase gateway), unless a `draft` is
   supplied. Falls back to a template if the AI call fails.
2. Send it for real via `@pebble/outreach`:
   `backendFromEnv().sendText(handle, message)`. `delivered` mirrors the send
   result `.ok`.
3. If Instagram isn't configured (or the send throws), returns
   `{ ok: true, delivered: false, message }` — composed but not sent.

## Running the RocketRide engine locally (Docker, `:5565`)

The primary path expects a RocketRide engine. To run one locally:

```bash
# Pull and run the engine; it listens on :5565
docker run --rm -p 5565:5565 rocketride/engine:latest

# Point the wrapper at it (defaults to http://localhost:5565)
export ROCKETRIDE_URI=http://localhost:5565
export ROCKETRIDE_APIKEY=...            # if the engine requires auth
```

Then author/iterate on the `.pipe` graphs in the VS Code extension and load them
via `createRocketRideClient().useDiscoveryPipe()`. When the engine is **not**
reachable, `runDiscovery` silently uses the fallback path above.

## Environment variables

| Var | Used by | Notes |
|---|---|---|
| `ROCKETRIDE_URI` | primary | engine WebSocket/HTTP URI; defaults to `http://localhost:5565` |
| `ROCKETRIDE_APIKEY` | primary | engine API key (if required) |
| `ROCKETRIDE_BUTTERBASE_KEY` | `discovery.pipe` / `outreach.pipe` | gateway key for the `llm_openai` node |
| `XTRACE_API_KEY`, `XTRACE_ORG_ID` | `.pipe` memory node | XTrace memory |
| `BUTTERBASE_APP_ID` / `NEXT_PUBLIC_BUTTERBASE_APP_ID` | fallback + compose | Butterbase app |
| `BUTTERBASE_SERVICE_KEY` | fallback + compose | service key (server-only) |
| `IG_BACKEND`, `IG_USERNAME`, `IG_PASSWORD`, … | `runOutreach` send | see `@pebble/outreach` |

The `.pipe` files reference secrets only as `${ROCKETRIDE_*}` / `${XTRACE_*}` /
`${WEB_URL}` / `${ENGINE_URL}` placeholders — RocketRide substitutes them at
`use()` time, so nothing sensitive is committed.
