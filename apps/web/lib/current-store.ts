"use client";

import type { BrandInfo } from "@/lib/api";

/**
 * The "current store" the workspace is scoped to — set when a brand is
 * onboarded, read by the dashboard + chat. Kept in localStorage so a refresh
 * keeps you in the same brand workspace (the demo has no auth/multi-store).
 */
const KEY = "pebble.currentStore";

export interface CurrentStore {
  storeId: string;
  brand: BrandInfo;
}

export function setCurrentStore(s: CurrentStore): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function getCurrentStore(): CurrentStore | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CurrentStore) : null;
  } catch {
    return null;
  }
}
