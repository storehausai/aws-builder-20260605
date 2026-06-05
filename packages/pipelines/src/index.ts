/**
 * @pebble/pipelines — the orchestration layer.
 *
 * Wraps RocketRide (the authored `.pipe` graphs in the repo-root `pipelines/`
 * directory) and exposes a clean, stable API to the web app and the messaging
 * worker. Both entry points (runDiscovery / runOutreach) degrade gracefully so
 * the demo works even with no RocketRide engine running.
 */
import "dotenv/config";

export type {
  InfluencerSuggestion,
  DiscoveryResult,
  OutreachResult,
  DiscoveryInput,
  OutreachInput,
  PanelInput,
  PanelResult,
  ReplyMessage,
} from "./types.js";

export { runDiscovery } from "./discovery.js";
export { runOutreach } from "./outreach.js";
export { generatePanel } from "./panel.js";
export { pollReplies } from "./replies.js";
export {
  createRocketRideClient,
  isReachable as isRocketRideReachable,
  discoveryPipePath,
  outreachPipePath,
  type RocketRideClientWrapper,
  type RocketRideSession,
} from "./rocketride.js";
