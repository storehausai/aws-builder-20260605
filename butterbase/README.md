# Butterbase schema

`schema.json` is the declarative database schema for the pebble-hackathon app on
[Butterbase](https://butterbase.dev). It ports pebble's canonical Postgres schema (the Supabase
migrations in `pebble/supabase/migrations/*.sql`) 1:1, then adds the four new tables that drive the
homepage → outreach flow (BUILD-PLAN.md §3).

Butterbase runs Postgres, so the Supabase DDL maps almost directly. The file is the *desired state*:
the platform diffs it against the live database and only applies the differences (idempotent).

## How to provision

Apply via either the Butterbase MCP tool or the HTTP API. **Always dry-run first.**

### MCP (`manage_schema`)

```jsonc
// 1. preview — returns the SQL statements without executing
manage_schema({ schema: <contents of schema.json>, dry_run: true })

// 2. apply
manage_schema({ schema: <contents of schema.json>, name: "pebble canonical + outreach" })
```

(`manage_migrations` / the SDK `AdminSchemaClient.apply(schema, { dryRun, name })` are equivalent.)

### HTTP

```bash
# dry run
curl -X POST https://api.butterbase.dev/v1/{app_id}/schema/apply \
  -H "Authorization: Bearer $BUTTERBASE_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "schema": '"$(cat butterbase/schema.json)"', "dry_run": true }'

# apply (omit dry_run or set false)
curl -X POST https://api.butterbase.dev/v1/{app_id}/schema/apply \
  -H "Authorization: Bearer $BUTTERBASE_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "schema": '"$(cat butterbase/schema.json)"', "name": "pebble canonical + outreach" }'
```

Destructive ops (dropping tables/columns) are blocked unless you explicitly add `_drop` /
`_dropColumns` — this schema contains neither, so re-applying is always safe.

## Tables & natural keys

The ingestion layer **upserts on these natural keys** (composite keys are enforced as `unique`
indexes; single-column keys use the column-level `unique` flag). Getting these right is critical —
they are the dedup boundary for every provider fetch.

| Table | Natural key (unique) |
|-------|----------------------|
| `data_provider` | `id` (text PK, e.g. `keepa`, `apify.apidojo`) |
| `stores` | `slug` |
| `store_members` | (`store_id`, `user_id`) |
| `social_account` | (`platform`, `platform_account_id`) |
| `social_account_post` | (`account_id`, `external_id`) |
| `social_account_snapshot` | (`account_id`, `snapshot_date`) |
| `social_post_snapshot` | (`post_id`, `snapshot_date`) |
| `brand` | `slug` |
| `brand_account` | (`brand_id`, `account_id`) — was the composite PK in pebble |
| `brand_mention` | (`brand_id`, `platform`, `external_id`) |
| `tracked_brand` | (`store_id`, `brand_id`) |
| `commerce_product` | (`marketplace`, `external_id`) — `external_id` = ASIN |
| `commerce_product_snapshot` | (`product_id`, `snapshot_date`) |
| `detected_event` | (`product_id`, `event_date`, `method`) |

Tables without a natural key (`requests`, `panels`, `social_fetch_raw`, `commerce_fetch_raw`,
`attribution`, and all four outreach tables) are keyed only by their surrogate `id` PK and are
append-only or store-scoped.

### Open-provenance design

`provider_id` columns are plain text foreign keys into `data_provider` (no `CHECK` constraint).
Adding a vendor (Keepa, Modash, SocialBlade, ...) is a single `INSERT` plus an adapter, never a
migration. `platform` / `marketplace` are likewise open text. The `*_fetch_raw` tables store every
provider response verbatim (L0) so the canonical L1 tables can be re-normalized without re-fetching.

## New outreach tables (BUILD-PLAN §3)

`brand_profile` → `influencer_candidate` → `outreach_thread` → `outreach_message`. All are
`store_id`-scoped. They model the flow: extract a brand brief from a homepage URL, suggest ranked
creators, open a DM thread per approved creator, and log every inbound/outbound message (the proof
the Instagram DM was sent and the reply relayed). Column shapes match the build plan exactly,
including `int8`/`float8` aliases for `followers`/`score`.

## Type mapping (Postgres → Butterbase)

Butterbase accepts native Postgres type names, so most types pass through unchanged:

| pebble (Postgres) | schema.json |
|-------------------|-------------|
| `uuid` | `uuid` |
| `text` | `text` |
| `text[]` | `text[]` |
| `bigint` | `bigint` |
| `integer` | `integer` |
| `numeric` | `numeric` |
| `boolean` | `boolean` |
| `date` | `date` |
| `timestamptz` | `timestamptz` |
| `jsonb` | `jsonb` |

The build plan spec'd the outreach columns with `int8` / `float8` (Postgres aliases for
`bigint` / `double precision`); those are kept verbatim as Butterbase accepts both. pebble's
canonical tables already used `bigint` / `numeric`, so those names are preserved as-is rather than
collapsed to `int8` / `float8`.

## Things that did NOT map cleanly (handled outside schema.json)

The Butterbase schema DSL only models tables, columns, constraints, and indexes. The following
Postgres features from pebble's migrations have **no declarative equivalent** and must be applied
separately (raw SQL migration, or the documented Butterbase mechanism):

1. **`auth.users` foreign keys.** In pebble, `stores.owner_id`, `store_members.user_id`,
   `requests.created_by`, and `panels`'s ownership chain reference `auth.users(id)` (Supabase Auth).
   Butterbase Auth replaces Supabase Auth and there is no `auth.users` table to reference, so these
   columns are declared as plain `uuid` **without** a `references`. They should hold the Butterbase
   auth user id. `ON DELETE CASCADE` to the user is therefore not enforced at the DB level here.

2. **`updated_at` triggers (`set_updated_at()` + `BEFORE UPDATE` triggers).** pebble bumps
   `updated_at` via a trigger on `stores`, `requests`, `panels`, `social_account`, `brand`, and
   `commerce_product`. The DSL has no trigger support; `updated_at` defaults to `now()` on insert,
   but updates must set it in application code (or add the trigger via raw SQL).

3. **`CHECK` constraints / enums.** pebble has `CHECK` constraints on `store_members.role`
   (`admin|member`), `panels.format` (`react|html|spec`). These are intentionally dropped — the
   design favors open text values (mirroring the open `provider_id`/`platform` philosophy). Valid
   values are documented as comments in the build plan and enforced in application code. Re-add via
   raw SQL if strict DB enforcement is wanted.

4. **Row Level Security (RLS) policies + `is_store_member()`.** Every pebble table enables RLS;
   store-scoped tables (`stores`, `store_members`, `requests`, `panels`, `tracked_brand`) carry a
   member policy, and GLOBAL tables enable RLS with no public policy (server-only via service key).
   RLS is **not** part of the schema DSL — configure it with the Butterbase RLS tooling
   (`manage_rls` / `create_rls_policy` with `user_column`) after the schema is applied. The new
   outreach tables and `brand_profile`/`influencer_candidate` are all `store_id`-scoped and should
   get the same store-member policy.

5. **`pgcrypto` extension.** `gen_random_uuid()` defaults assume `pgcrypto`. Butterbase provides
   this by default; if a fresh app errors, enable the extension first.

6. **Functional / partial index `social_account (platform, lower(handle))`.** pebble has an index
   on the expression `lower(handle)`. The DSL only supports plain column-list indexes, so this
   expression index is omitted. Add it via raw SQL if case-insensitive handle lookups need it.

7. **ON DELETE CASCADE / SET NULL semantics.** `references` in the DSL records the FK target but
   does not express the delete action. pebble's `ON DELETE CASCADE` (e.g. snapshots → parent) and
   `ON DELETE SET NULL` (e.g. `commerce_product.brand_id`) are not represented; if cascade behavior
   is required, add it via raw SQL ALTER.
