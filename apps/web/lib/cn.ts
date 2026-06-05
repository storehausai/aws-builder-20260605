import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatFollowers(n?: number): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

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

export function hostFromUrl(url: string): string {
  try {
    const u = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
