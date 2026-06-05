import type { Bb } from "./client.js";
import { unwrap, unwrapMaybe } from "./client.js";

/**
 * Butterbase has no native `upsert(onConflict)`, so we emulate it: for each row
 * (deduped by its natural key), check existence by the conflict columns, then
 * UPDATE or INSERT. This preserves the idempotent-cache property — re-running
 * a tool MERGES on the natural key instead of duplicating — at the cost of a
 * read per row (fine at hackathon volumes; batch this later if it bites).
 */

type Row = Record<string, unknown>;

function dedupe(rows: Row[], conflictCols: string[]): Row[] {
  const seen = new Map<string, Row>();
  for (const r of rows) seen.set(conflictCols.map((c) => String(r[c])).join("|"), r);
  return [...seen.values()];
}

/** Upsert a batch on a composite natural key. No return value. */
export async function upsertRows(bb: Bb, table: string, rows: Row[], conflictCols: string[]): Promise<void> {
  for (const row of dedupe(rows, conflictCols)) {
    const id = await findExistingId(bb, table, row, conflictCols);
    if (id != null) {
      // Butterbase UPDATE only filters by the primary key `id` (filtering by a
      // natural-key column 404s), so we resolve the id then update by it.
      const res = await bb.from(table).update(row).eq("id", id);
      if (res.error) throw new Error(`${table} update: ${String(res.error)}`);
    } else {
      const res = await bb.from(table).insert(row);
      if (res.error) throw new Error(`${table} insert: ${String(res.error)}`);
    }
  }
}

/** Upsert a single row and return it (e.g. to read back a generated id). */
export async function upsertReturning<T extends Row = Row>(
  bb: Bb,
  table: string,
  row: Row,
  conflictCols: string[],
  returning = "*",
): Promise<T> {
  const id = await findExistingId(bb, table, row, conflictCols);
  if (id != null) {
    const res = await bb.from(table).update(row).eq("id", id);
    if (res.error) throw new Error(`${table} update: ${String(res.error)}`);
  } else {
    const ins = await bb.from(table).insert(row);
    if (ins.error) throw new Error(`${table} insert: ${String(ins.error)}`);
  }
  return selectOne<T>(bb, table, row, conflictCols, returning);
}

/** Plain insert that returns the inserted row (no conflict handling). */
export async function insertReturning<T extends Row = Row>(
  bb: Bb,
  table: string,
  row: Row,
  returning = "*",
): Promise<T> {
  const res = await bb.from(table).insert(row).select(returning);
  if (res.error) throw new Error(`${table} insert: ${String(res.error)}`);
  const data = res.data as T | T[] | null;
  if (data == null) throw new Error(`${table} insert: no row returned`);
  return Array.isArray(data) ? (data[0] as T) : (data as T);
}

/** Resolve the primary-key `id` of an existing row matching the natural key. */
async function findExistingId(bb: Bb, table: string, row: Row, conflictCols: string[]): Promise<string | null> {
  let sel = bb.from(table).select("id");
  for (const c of conflictCols) sel = sel.eq(c, row[c]);
  const found = unwrapMaybe(await sel.maybeSingle()) as { id?: string } | null;
  return found?.id ?? null;
}

async function selectOne<T extends Row>(
  bb: Bb,
  table: string,
  row: Row,
  conflictCols: string[],
  returning: string,
): Promise<T> {
  let sel = bb.from(table).select(returning);
  for (const c of conflictCols) sel = sel.eq(c, row[c]);
  return unwrap(await sel.single()) as unknown as T;
}
