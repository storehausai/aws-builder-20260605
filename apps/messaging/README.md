# @pebble/messaging

The Photon / [Spectrum](https://www.npmjs.com/package/spectrum-ts) worker that
connects the agent to messaging. It is one long-lived process that runs **two
concurrent loops**:

1. **Marketer → agent (iMessage).** Inbound iMessage text is passed to
   `runDiscovery({ text })` from `@pebble/pipelines`, and the result is sent back
   to the same iMessage conversation (plus, optionally, the top influencers as
   text lines). This makes the agent reachable over iMessage.

2. **Influencer → marketer (Instagram → iMessage relay).** Instagram is **not** a
   built-in Spectrum provider, so influencer DM replies are picked up by a
   **separate concurrent poll loop** against `@pebble/outreach`'s private backend
   (`PrivateApiBackend.pollInbound(sinceMs)`). For each new inbound DM the worker
   (a) records it to Butterbase (`outreach_message` row via `@pebble/bb`), and
   (b) relays it to the marketer's iMessage.

Both loops run together under `Promise.all`. The worker boots and **stays up**
even if Instagram isn't logged in or Butterbase isn't configured — those
features warn and disable themselves while the iMessage loop keeps running. No
single bad poll can kill the process.

## Why a concurrent poll loop, not `definePlatform`?

spectrum-ts v1.18.0 does export `definePlatform`, but registering Instagram as a
real Spectrum provider means authoring zod config/user/space/message schemas, a
`createClient`, a `messages` async generator and `send` actions, then wiring them
into a running `Spectrum(...)` instance. Our IG access is an unofficial
`instagram-private-api` **inbox poll** (no webhook, no realtime stream), so the
provider abstraction buys little here. Per the build guidance ("keep the simple
concurrent-poll approach … don't over-engineer"), Instagram inbound lives in
[`src/instagram-channel.ts`](./src/instagram-channel.ts) as a decoupled loop.
This keeps IG fully independent of Spectrum and trivially resilient.

## Run

```bash
# from the repo root
pnpm --filter @pebble/messaging start     # tsx src/worker.ts
pnpm --filter @pebble/messaging dev        # tsx watch (reload on change)
pnpm --filter @pebble/messaging typecheck  # tsc --noEmit
```

With no `PROJECT_ID` / `PROJECT_SECRET` the worker starts in **projectless local
dev** using Spectrum's `terminal` provider — you type into the terminal to
simulate the marketer and the agent's reply prints back. This lets you exercise
the discovery loop without Spectrum Cloud credentials. (In terminal mode the
IG→marketer relay is disabled, since the relay target is an iMessage space.)

## Environment variables

| Var | Required | Purpose |
| --- | --- | --- |
| `PROJECT_ID` | for iMessage | Spectrum Cloud project id. **Absent → `terminal` provider fallback.** |
| `PROJECT_SECRET` | for iMessage | Spectrum Cloud project secret. |
| `MARKETER_IMESSAGE` | for IG relay | The marketer's iMessage handle (phone/email) that influencer replies are relayed to. For the demo a single configured handle is fine. |
| `IG_POLL_MS` | no | Instagram inbox poll interval, ms. Default `15000`. |
| `IG_USERNAME` / `IG_PASSWORD` | for IG relay | Credentials for `@pebble/outreach`'s `instagram-private-api` backend. Absent → IG loop logs a warning and idles. |
| `IG_BACKEND` | no | `private` (default) — required for the inbox-polling path used here. |
| `IG_SESSION_PATH` | no | Path to the serialized IG session JSON (default `.ig-session.json`). |
| `IG_PROXY` | no | Optional proxy URL for IG stability. |
| `BUTTERBASE_APP_ID` (or `NEXT_PUBLIC_BUTTERBASE_APP_ID`) | for recording | Butterbase app id. Absent → message recording is skipped. |
| `BUTTERBASE_SERVICE_KEY` | for recording | Service key (`bb_sk_…`), bypasses RLS. Server-only. |
| `NEXT_PUBLIC_BUTTERBASE_API_URL` | no | Butterbase API base (default `https://api.butterbase.ai`). |

See `@pebble/outreach` for the full Instagram env surface and the `pnpm ig:login`
session-bootstrap flow.

## iMessage setup

iMessage is Spectrum's shipping provider. Two ways to wire it:

- **Spectrum Cloud number (no Mac needed).** Provision a number/project in
  Spectrum Cloud and set `PROJECT_ID` + `PROJECT_SECRET`. The worker uses
  `imessage.config()`.
- **Local `imessage-kit` on a Mac.** Run the worker on a macOS machine with
  **Full Disk Access** granted to the terminal (so it can read
  `~/Library/Messages/chat.db`) and Messages signed in. This is the
  "integrate iPhone" path.

The IG → marketer relay resolves the marketer's iMessage DM space with
`imessage(app).space({ phone: MARKETER_IMESSAGE })` and sends the relay text
there.

## Files

- `src/worker.ts` — entrypoint; builds the Spectrum app, runs both loops.
- `src/config.ts` — env loading + degraded-mode flags.
- `src/discovery.ts` — adapter around `@pebble/pipelines`' `runDiscovery`
  (resolved dynamically so this worker compiles/runs even before pipelines
  exports it).
- `src/instagram-channel.ts` — the concurrent IG inbound poll loop.
- `src/butterbase-recorder.ts` — best-effort `outreach_message` recording.
