import { MemoryClient } from "@xtraceai/memory";
import type { Memory } from "@xtraceai/memory";

/**
 * `@pebble/memory` — a thin, domain-focused wrapper over XTrace's hosted memory
 * SDK (`@xtraceai/memory`).
 *
 * Memory is scoped **per brand**: every method takes a `storeId`, which we map
 * onto XTrace's `user_id` axis. That gives each store an isolated namespace for
 * its brand brief and outreach-outcome facts.
 *
 * ## Why this matters (belief revision)
 *
 * XTrace performs belief revision on ingest: when a newly-extracted fact
 * contradicts an older one, the old fact is automatically **superseded** rather
 * than left to rot alongside the new truth. For pebble this is the missing
 * feedback loop — as we record outcomes ("creator X replied", "creator X did
 * NOT convert", "creator X converted"), the store's memory stays *honest* about
 * which creators actually convert for *this* brand over time, instead of
 * accumulating stale or conflicting notes. `recall` then surfaces that
 * continuously-corrected picture as a ready-to-prepend prompt for the agent.
 */
export interface PebbleMemory {
  /** Step 1: persist the brand brief extracted from the homepage. */
  writeBrandBrief(storeId: string, brief: string, convId?: string): Promise<void>;
  /** Steps 5–7: persist an outcome fact (contacted/replied/converted). */
  recordOutcome(storeId: string, fact: string, convId?: string): Promise<void>;
  /** Recall relevant memory as a ready-to-prepend prompt string for the agent. */
  recall(storeId: string, query: string): Promise<string>;
  /** Raw search → array of fact strings. */
  search(storeId: string, query: string): Promise<string[]>;
}

/** Options for {@link createMemory}. Falls back to env vars when omitted. */
export interface CreateMemoryOptions {
  /** XTrace API key (`xtk_…`). Defaults to `process.env.XTRACE_API_KEY`. */
  apiKey?: string;
  /** XTrace org id (`org_…`). Defaults to `process.env.XTRACE_ORG_ID`. */
  orgId?: string;
  /** XTrace API base URL. Defaults to `process.env.XTRACE_API_URL` (the SDK's
   *  default host otherwise) — required when your org is on a non-default
   *  instance such as `https://api.production.xtrace.ai`. */
  baseUrl?: string;
}

/**
 * Default conversation anchor used when a caller doesn't supply one. XTrace
 * requires every ingest to be anchored to a `conv_id`; brand-brief / outcome
 * writes aren't inherently conversational, so we anchor them to a stable
 * per-store bucket instead.
 */
function defaultConvId(storeId: string): string {
  return `store:${storeId}`;
}

class PebbleMemoryImpl implements PebbleMemory {
  /** Lazily-constructed underlying client (see {@link client}). */
  #client: MemoryClient | undefined;

  constructor(private readonly opts: CreateMemoryOptions) {}

  /**
   * Resolve the XTrace client lazily so that a missing API key / org id only
   * throws when a method is actually called — never at import time.
   */
  private client(): MemoryClient {
    if (this.#client) return this.#client;

    const apiKey = this.opts.apiKey ?? process.env.XTRACE_API_KEY;
    const orgId = this.opts.orgId ?? process.env.XTRACE_ORG_ID;

    if (!apiKey || !orgId) {
      const missing = [
        apiKey ? null : "XTRACE_API_KEY",
        orgId ? null : "XTRACE_ORG_ID",
      ]
        .filter((v): v is string => v !== null)
        .join(" and ");
      throw new Error(
        `@pebble/memory: missing ${missing}. Pass { apiKey, orgId } to createMemory() ` +
          `or set the XTRACE_API_KEY / XTRACE_ORG_ID environment variables.`,
      );
    }

    const baseUrl = this.opts.baseUrl ?? process.env.XTRACE_API_URL;
    this.#client = new MemoryClient({ apiKey, orgId, ...(baseUrl ? { baseUrl } : {}) });
    return this.#client;
  }

  /**
   * Ingest a single text turn under this store's namespace. Used by both
   * {@link writeBrandBrief} and {@link recordOutcome}.
   */
  private async ingestText(
    storeId: string,
    content: string,
    convId: string | undefined,
  ): Promise<void> {
    await this.client().memories.ingest(
      {
        messages: [{ role: "user", content }],
        user_id: storeId,
        conv_id: convId ?? defaultConvId(storeId),
      },
      { wait: true },
    );
  }

  async writeBrandBrief(storeId: string, brief: string, convId?: string): Promise<void> {
    await this.ingestText(storeId, brief, convId);
  }

  async recordOutcome(storeId: string, fact: string, convId?: string): Promise<void> {
    await this.ingestText(storeId, fact, convId);
  }

  async recall(storeId: string, query: string): Promise<string> {
    try {
      const { prompt } = await this.client().memories.recall({
        query,
        pools: [{ user_id: storeId }],
      });
      return prompt ?? "";
    } catch {
      // Be resilient: a memory outage must never break the agent turn.
      return "";
    }
  }

  async search(storeId: string, query: string): Promise<string[]> {
    try {
      const res = await this.client().memories.search({
        query,
        user_id: storeId,
      });
      return res.data.map((m: Memory) => m.text);
    } catch {
      return [];
    }
  }
}

/**
 * Create a {@link PebbleMemory} instance.
 *
 * Credentials are read from `XTRACE_API_KEY` / `XTRACE_ORG_ID` when not passed
 * explicitly. Resolution is **lazy**: construction never throws, and a clear
 * error is raised only when a method is first called without valid credentials.
 */
export function createMemory(opts: CreateMemoryOptions = {}): PebbleMemory {
  return new PebbleMemoryImpl(opts);
}
