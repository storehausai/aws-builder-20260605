/**
 * @pebble/bb — Butterbase backend access.
 * Canonical data layer + AI gateway + storage, on a Supabase-shaped SDK.
 */
export { createBb, unwrap, unwrapMaybe, type Bb, type BbOptions } from "./client.js";
export { upsertRows, upsertReturning, insertReturning } from "./upsert.js";
export { chat, chatText, DEFAULT_MODEL, FAST_MODEL } from "./ai.js";
export { uploadHtmlPanel } from "./storage.js";
export {
  ensureMessagingStore,
  savePanel,
  loadPanel,
  type PanelSpec,
  type PanelInfluencer,
  type SavedPanel,
} from "./panels.js";
export { createIngestionWriter } from "./ingest.js";
