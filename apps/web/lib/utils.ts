import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware className combiner (clsx + tailwind-merge). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** True on macOS — used to pick ⌘ vs Ctrl in keyboard-shortcut hints. */
export const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPod|iPad/.test(navigator.platform);

/** 1.2M / 14.3K / 932 — compact follower formatting. */
export function formatFollowers(n?: number): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

/** "Acme" from https://www.acme.com/foo. */
export function brandFromUrl(url: string): string {
  try {
    const u = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const host = new URL(u).hostname.replace(/^www\./, "");
    const core = host.split(".")[0] ?? host;
    return core.charAt(0).toUpperCase() + core.slice(1);
  } catch {
    return "your brand";
  }
}

/** "acme.com" from https://www.acme.com/foo. */
export function hostFromUrl(url: string): string {
  try {
    const u = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
