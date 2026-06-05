# @pebble/engine-service

A tiny HTTP service that exposes the pure `@pebble/engine` market-mover math so
RocketRide can call it as a `tool_http_request` node, and the web app can read
it over HTTP.

It reads canonical data from **Butterbase** via `@pebble/bb`, shapes it into the
engine's `MarketMoverInput`, runs `findMarketMovers`, and returns the engine's
`MarketMoverResult` verbatim.

## Run

```bash
# against Butterbase (needs env, see below)
pnpm --filter @pebble/engine-service dev

# smoke test with NO Butterbase configured — reads a local BSR fixture
# (set ENGINE_FIXTURE_PATH to point at the fixture JSON)
ENGINE_FIXTURES=1 ENGINE_FIXTURE_PATH=./fixtures/bsr-daily.json pnpm --filter @pebble/engine-service dev
```

Listens on `ENGINE_PORT` (default **8787**).

### Env

| var | purpose |
| --- | --- |
| `ENGINE_PORT` | listen port (default `8787`) |
| `BUTTERBASE_APP_ID` (or `NEXT_PUBLIC_BUTTERBASE_APP_ID`) | Butterbase app id |
| `BUTTERBASE_SERVICE_KEY` | service key (`bb_sk_…`, bypasses RLS — server only) |
| `NEXT_PUBLIC_BUTTERBASE_API_URL` | API base (default `https://api.butterbase.ai`) |
| `ENGINE_FIXTURES` | `1` → read the local fixture instead of Butterbase |
| `ENGINE_FIXTURE_PATH` | override the fixture path |

`.env` is loaded automatically (`dotenv`).

## Endpoints (contract — do not change shapes)

### `GET /health`
```bash
curl -s localhost:8787/health
# {"ok":true}
```

### `POST /market-movers`
Body: `{ scope: "brand" | "asin", identifier: string, storeId?: string }`
→ `MarketMoverResult` = `{ productTitle, spikes, attributed, topAttribution }`.

```bash
curl -s localhost:8787/market-movers \
  -H 'content-type: application/json' \
  -d '{"scope":"brand","identifier":"Rael"}'

curl -s localhost:8787/market-movers \
  -H 'content-type: application/json' \
  -d '{"scope":"asin","identifier":"B09G6BWNDP"}'
```

### `POST /attribute`
Body: `{ scope, identifier, eventId?, storeId? }`
→ the same `MarketMoverResult` artifact, with `topAttribution` focused on the
spike named by `eventId` (a spike **date** `YYYY-MM-DD` or **index**) when given;
otherwise the engine's strongest attribution stands.

```bash
curl -s localhost:8787/attribute \
  -H 'content-type: application/json' \
  -d '{"scope":"brand","identifier":"Rael"}'

curl -s localhost:8787/attribute \
  -H 'content-type: application/json' \
  -d '{"scope":"brand","identifier":"Rael","eventId":"2025-08-11"}'
```

## Resilience

The demo must not crash:

- Bad body / bad `scope` / missing `identifier` → **400** `{ error }`.
- Missing Butterbase env → **503** `{ error, hint }`.
- Expected data gaps (brand not cached, no products, no snapshots) →
  **200** `{ error }` (operational, not a crash).
- Empty creator content → the engine still runs; verdicts degrade to
  `"unexplained"`.
- `unhandledRejection` / `uncaughtException` are logged, never fatal.

## How it reads Butterbase

`createBb()` → service client, then the Supabase-shaped query builder:

1. **Resolve products** — `commerce_product` by `external_id` (ASIN) or by
   `brand_id` (resolved from `brand` via `slug`).
2. **Snapshots** — `commerce_product_snapshot` (`snapshot_date, rank, price`)
   per product, ordered ascending; aligned onto a shared sorted date axis;
   ranks forward-filled into a continuous `number[]`.
3. **Flagship** — the product with the best (lowest) observed rank.
4. **Content** — `brand_mention` for the brand → `CreatorMention[]`
   (paginated via `.range()`, capped at 12k rows).
5. Shape `MarketMoverInput` → `findMarketMovers(input)` → return the result.
