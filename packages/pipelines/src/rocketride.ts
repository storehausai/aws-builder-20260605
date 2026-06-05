/**
 * Thin RocketRide wrapper — the PRIMARY orchestration path.
 *
 * When a RocketRide engine is reachable (ROCKETRIDE_URI / ROCKETRIDE_APIKEY, or a
 * local Docker engine on :5565) we load the authored `.pipe` graphs and drive the
 * agent through them. Everything here degrades gracefully: callers can probe
 * `isReachable()` first and fall back to the in-process path (see discovery.ts).
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { RocketRideClient, Question } from "rocketride";
import type { PIPELINE_RESULT } from "rocketride";

const DEFAULT_LOCAL_URI = "http://localhost:5565";

/** Absolute path to the repo-root `pipelines/` directory (sibling of `packages/`). */
function pipelinesDir(): string {
  // src/rocketride.ts -> packages/pipelines/src -> repo root /pipelines
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "..", "pipelines");
}

export function discoveryPipePath(): string {
  return resolve(pipelinesDir(), "discovery.pipe");
}

export function outreachPipePath(): string {
  return resolve(pipelinesDir(), "outreach.pipe");
}

export function rocketRideUri(): string {
  return process.env.ROCKETRIDE_URI ?? DEFAULT_LOCAL_URI;
}

export function rocketRideApiKey(): string | undefined {
  return process.env.ROCKETRIDE_APIKEY;
}

/**
 * Is a RocketRide engine reachable? Probes the public capabilities endpoint with a
 * short timeout — never throws, just returns a boolean so the caller can choose a path.
 */
export async function isReachable(timeoutMs = 1500): Promise<boolean> {
  try {
    await RocketRideClient.getServerInfo(rocketRideUri(), timeoutMs);
    return true;
  } catch {
    return false;
  }
}

/** Pull the first answers/text payload out of a pipeline result, as a string. */
export function extractAnswerText(result: PIPELINE_RESULT | undefined): string {
  if (!result) return "";
  const types = result.result_types ?? {};
  for (const [field, kind] of Object.entries(types)) {
    if (kind === "answers" || kind === "text") {
      const v = (result as Record<string, unknown>)[field];
      if (Array.isArray(v)) return v.map(String).join("\n").trim();
      if (typeof v === "string") return v.trim();
    }
  }
  // Fall back to common field names if result_types is absent.
  for (const field of ["answers", "text", "output", "content", "result"]) {
    const v = (result as Record<string, unknown>)[field];
    if (Array.isArray(v)) return v.map(String).join("\n").trim();
    if (typeof v === "string") return v.trim();
  }
  return "";
}

/**
 * A connected RocketRide session bound to a loaded pipeline. `chat()` asks the
 * agent a question; `terminate()` / `disconnect()` clean up.
 */
export interface RocketRideSession {
  token: string;
  chat(text: string, onSSE?: (type: string, data: Record<string, unknown>) => Promise<void>): Promise<string>;
  terminate(): Promise<void>;
  disconnect(): Promise<void>;
}

/**
 * Thin client factory. Returns a small, stable surface over RocketRideClient:
 * connect, load a `.pipe`, chat against it, and tear down.
 */
export function createRocketRideClient() {
  let client: RocketRideClient | undefined;

  function raw(): RocketRideClient {
    if (!client) {
      client = new RocketRideClient({
        auth: rocketRideApiKey(),
        uri: rocketRideUri(),
      });
    }
    return client;
  }

  async function connect(): Promise<RocketRideClient> {
    const c = raw();
    if (!c.isConnected()) await c.connect(rocketRideApiKey(), { uri: rocketRideUri() });
    return c;
  }

  /** Load a pipeline file and return a session you can chat against. */
  async function use(filepath: string): Promise<RocketRideSession> {
    const c = await connect();
    const started = await c.use({ filepath });
    const token = started.token;
    return {
      token,
      async chat(text, onSSE) {
        const q = new Question();
        q.addQuestion(text);
        const res = await c.chat({ token, question: q, onSSE });
        return extractAnswerText(res);
      },
      async terminate() {
        await c.terminate(token);
      },
      async disconnect() {
        await c.disconnect();
      },
    };
  }

  return {
    connect,
    use,
    /** Convenience: load discovery.pipe. */
    useDiscoveryPipe: () => use(discoveryPipePath()),
    /** Convenience: load outreach.pipe. */
    useOutreachPipe: () => use(outreachPipePath()),
    /** Direct chat against an already-running task token. */
    async chat(token: string, text: string): Promise<string> {
      const c = await connect();
      const q = new Question();
      q.addQuestion(text);
      const res = await c.chat({ token, question: q });
      return extractAnswerText(res);
    },
    isReachable,
    disconnect: async () => {
      if (client && client.isConnected()) await client.disconnect();
    },
    raw,
  };
}

export type RocketRideClientWrapper = ReturnType<typeof createRocketRideClient>;
