import { createClient, type ButterbaseClient, type ButterbaseResponse } from "@butterbase/sdk";

/**
 * @pebble/bb — typed access to the Butterbase backend (replaces @pebble/db's
 * Supabase client). Same role: the canonical data layer + the AI gateway. The
 * service key bypasses RLS, so it reads the GLOBAL moat and writes across stores
 * — server-only, NEVER ship it to the browser.
 */
export type Bb = ButterbaseClient;

export interface BbOptions {
  appId?: string;
  apiUrl?: string;
  /** Service key (bb_sk_...). Bypasses RLS. Omit for an anon browser client. */
  serviceKey?: string;
  anonKey?: string;
}

/** Server-side service client (the agent + ingestion jobs use this). */
export function createBb(opts: BbOptions = {}): Bb {
  const appId = opts.appId ?? process.env.BUTTERBASE_APP_ID ?? process.env.NEXT_PUBLIC_BUTTERBASE_APP_ID;
  const apiUrl =
    opts.apiUrl ?? process.env.NEXT_PUBLIC_BUTTERBASE_API_URL ?? "https://api.butterbase.ai";
  const serviceKey = opts.serviceKey ?? process.env.BUTTERBASE_SERVICE_KEY;
  if (!appId) throw new Error("BUTTERBASE_APP_ID (or NEXT_PUBLIC_BUTTERBASE_APP_ID) is required");

  const client = createClient({ appId, apiUrl, anonKey: opts.anonKey, persistSession: false });
  if (serviceKey) client.setAccessToken(serviceKey);
  return client;
}

/** Throw on error / null; return the data. */
export function unwrap<T>(res: ButterbaseResponse<T>): T {
  if (res.error) throw new Error(errText(res.error));
  if (res.data == null) throw new Error("Butterbase: expected a row, got null");
  return res.data;
}

/** Throw on error; return data or null (for maybeSingle reads). */
export function unwrapMaybe<T>(res: ButterbaseResponse<T>): T | null {
  if (res.error) throw new Error(errText(res.error));
  return res.data;
}

function errText(err: unknown): string {
  const e = err as { message?: string; code?: string; remediation?: string };
  return [e?.code, e?.message, e?.remediation].filter(Boolean).join(" — ") || String(err);
}

export type { ButterbaseResponse, ButterbaseClient };
