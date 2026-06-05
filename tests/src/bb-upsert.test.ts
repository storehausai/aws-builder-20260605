/**
 * DATA LAYER: Butterbase has no native upsert, so @pebble/bb emulates it. This
 * proves the idempotent-cache property the whole ingestion layer relies on:
 * re-writing on a natural key MERGES (updates) instead of duplicating. Uses an
 * in-memory mock of the Butterbase query builder — no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { upsertRows, upsertReturning, insertReturning } from "@pebble/bb";
import type { Bb } from "@pebble/bb";

type Row = Record<string, unknown>;

/** Minimal in-memory stand-in for the Butterbase query builder used by upsert.ts. */
class MockQuery {
  private filters: Array<[string, unknown]> = [];
  private op: "select" | "insert" | "update" = "select";
  private payload: Row | Row[] = {};
  private mode: "many" | "single" | "maybe" = "many";
  constructor(private store: Map<string, Row[]>, private table: string) {}
  private rows(): Row[] {
    if (!this.store.has(this.table)) this.store.set(this.table, []);
    return this.store.get(this.table)!;
  }
  select(_cols?: string): this {
    return this;
  }
  eq(c: string, v: unknown): this {
    this.filters.push([c, v]);
    return this;
  }
  single(): this {
    this.mode = "single";
    return this;
  }
  maybeSingle(): this {
    this.mode = "maybe";
    return this;
  }
  insert(row: Row | Row[]): this {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  update(row: Row): this {
    this.op = "update";
    this.payload = row;
    return this;
  }
  private match(r: Row): boolean {
    return this.filters.every(([c, v]) => String(r[c]) === String(v));
  }
  private resolveQuery(): { data: unknown; error: unknown } {
    const rows = this.rows();
    if (this.op === "insert") {
      const arr = Array.isArray(this.payload) ? this.payload : [this.payload];
      // Mimic Butterbase: every row gets a generated `id` primary key.
      const inserted = arr.map((r) => ({ id: r.id ?? `id_${rows.length + Math.round(Math.random() * 1e6)}`, ...r }));
      for (const r of inserted) rows.push(r);
      return { data: inserted, error: null };
    }
    if (this.op === "update") {
      for (const r of rows) if (this.match(r)) Object.assign(r, this.payload);
      return { data: null, error: null };
    }
    const found = rows.filter((r) => this.match(r));
    if (this.mode === "single") {
      return found.length === 1 ? { data: found[0], error: null } : { data: null, error: { message: "not single" } };
    }
    if (this.mode === "maybe") return { data: found[0] ?? null, error: null };
    return { data: found, error: null };
  }
  then<T>(res: (v: { data: unknown; error: unknown }) => T): Promise<T> {
    return Promise.resolve(this.resolveQuery()).then(res);
  }
}

function mockBb(): { bb: Bb; store: Map<string, Row[]> } {
  const store = new Map<string, Row[]>();
  const bb = { from: (t: string) => new MockQuery(store, t) } as unknown as Bb;
  return { bb, store };
}

test("upsertRows inserts once, then UPDATES on the natural key (no duplicate)", async () => {
  const { bb, store } = mockBb();
  await upsertRows(bb, "brand", [{ slug: "acme", name: "Acme" }], ["slug"]);
  await upsertRows(bb, "brand", [{ slug: "acme", name: "Acme Inc" }], ["slug"]);
  const rows = store.get("brand")!;
  assert.equal(rows.length, 1, "merged, not duplicated");
  assert.equal(rows[0]!.name, "Acme Inc", "updated in place");
});

test("upsertRows de-dupes a batch by the conflict key (last wins)", async () => {
  const { bb, store } = mockBb();
  await upsertRows(bb, "p", [{ k: "1", v: "a" }, { k: "1", v: "b" }], ["k"]);
  assert.equal(store.get("p")!.length, 1);
  assert.equal(store.get("p")![0]!.v, "b");
});

test("upsertReturning returns the row (read-back of a generated key)", async () => {
  const { bb } = mockBb();
  const row = await upsertReturning<{ slug: string; name: string }>(bb, "brand", { slug: "beta", name: "Beta" }, ["slug"], "*");
  assert.equal(row.slug, "beta");
  assert.equal(row.name, "Beta");
});

test("insertReturning returns the inserted row", async () => {
  const { bb } = mockBb();
  const row = await insertReturning<{ x: number }>(bb, "raw", { x: 1 }, "*");
  assert.equal(row.x, 1);
});
