import type { Bb } from "./client.js";
import { unwrap } from "./client.js";

/**
 * Storage helper — used to host a generated HTML panel so it can be delivered as
 * a link over iMessage (which can't render the inline iframe panel).
 */
export async function uploadHtmlPanel(bb: Bb, html: string, filename: string): Promise<{ objectId: string; url: string }> {
  const blob = new Blob([html], { type: "text/html" });
  const up = unwrap(await bb.storage.upload(blob, filename)) as { objectId?: string; id?: string; url?: string };
  const objectId = up.objectId ?? up.id ?? "";
  if (up.url) return { objectId, url: up.url };
  const dl = unwrap(await bb.storage.getDownloadUrl(objectId)) as { url?: string; downloadUrl?: string };
  return { objectId, url: dl.url ?? dl.downloadUrl ?? "" };
}
