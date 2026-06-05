/**
 * Centralized env config for the messaging worker.
 *
 * Everything is optional at the type level so the worker can boot in degraded
 * mode (e.g. no Spectrum Cloud creds → terminal provider; no IG creds → IG poll
 * loop logs a warning and idles). Required-for-a-given-feature checks happen at
 * the point of use, not here, so one missing var never blocks the rest.
 */

export interface MessagingConfig {
  /** Spectrum Cloud project id. Absent → fall back to the terminal provider. */
  projectId?: string;
  /** Spectrum Cloud project secret. */
  projectSecret?: string;
  /**
   * The marketer's iMessage handle (phone/email) we relay influencer replies to.
   * For the demo a single configured handle is fine.
   */
  marketerImessage?: string;
  /** IG inbox poll interval in ms. */
  igPollMs: number;
  /** Whether IG credentials look present (IG_USERNAME + IG_PASSWORD). */
  igConfigured: boolean;
  /** Whether Butterbase looks configured (app id present). */
  bbConfigured: boolean;
  /**
   * Public origin of the web app, used to build tappable panel links texted
   * back over iMessage. MUST be publicly reachable (a tunnel or a deploy) —
   * Photon fetches it to render the link-preview card, so `localhost` won't
   * unfurl. Falls back to WEB_URL when PUBLIC_WEB_URL is unset.
   */
  publicWebUrl?: string;
  /**
   * The fixed demo brand the iMessage agent grounds discovery on — the same
   * grounding the dashboard passes after onboarding. Over a text there's no
   * "logged-in store", so for the single-brand demo we pin one store/brand
   * here, making the iMessage reply match the dashboard chat exactly.
   */
  marketerStoreId?: string;
  marketerBrandUrl?: string;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MessagingConfig {
  const projectId = env.PROJECT_ID?.trim() || undefined;
  const projectSecret = env.PROJECT_SECRET?.trim() || undefined;
  return {
    projectId,
    projectSecret,
    marketerImessage: env.MARKETER_IMESSAGE?.trim() || undefined,
    igPollMs: num(env.IG_POLL_MS, 15_000),
    igConfigured: Boolean(env.IG_USERNAME?.trim() && env.IG_PASSWORD?.trim()),
    bbConfigured: Boolean(
      (env.BUTTERBASE_APP_ID ?? env.NEXT_PUBLIC_BUTTERBASE_APP_ID)?.trim(),
    ),
    publicWebUrl: (env.PUBLIC_WEB_URL ?? env.WEB_URL)?.trim() || undefined,
    // Default to the onboarded demo brand (Rael) so discovery is grounded the
    // same way the dashboard grounds it. Override per deployment via env.
    marketerStoreId:
      env.MARKETER_STORE_ID?.trim() || "46c2b764-633b-470d-aff1-0b7842ead84f",
    marketerBrandUrl: env.MARKETER_BRAND_URL?.trim() || "https://www.getrael.com",
  };
}

/** Have we got a usable Spectrum Cloud project? Both id + secret must be set. */
export function hasSpectrumCloud(cfg: MessagingConfig): boolean {
  return Boolean(cfg.projectId && cfg.projectSecret);
}
