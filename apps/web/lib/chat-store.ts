"use client";

import { useCallback, useSyncExternalStore } from "react";
import { nanoid } from "nanoid";

/**
 * Client-side, session-scoped chat store (localStorage + a tiny
 * pub/sub). Provides the chat data layer:
 * the sidebar history, new-chat, rename and archive all read/write here.
 * Messages live per-chat so a refresh keeps the conversation; everything
 * stays within the browser session as the spec allows.
 */

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Transient "agent working" step lines, revealed one-by-one. */
  steps?: string[];
  /** Discovery influencers attached to an assistant turn (drives the panel). */
  influencers?: StoredInfluencer[];
  createdAt: string;
}

export interface StoredInfluencer {
  handle: string;
  platform: string;
  pk?: string;
  followers?: number;
  score?: number;
  rationale: string;
}

export interface Chat {
  id: string;
  title: string | null;
  storeId: string;
  status: "open" | "archived";
  unread?: boolean;
  createdAt: string;
  updatedAt: string;
}

const CHATS_KEY = "pebble.chats";
const MSGS_PREFIX = "pebble.chat.msgs.";

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (typeof window !== "undefined") {
    window.addEventListener("storage", cb);
  }
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", cb);
    }
  };
}

function readChats(): Chat[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    return raw ? (JSON.parse(raw) as Chat[]) : [];
  } catch {
    return [];
  }
}

function writeChats(chats: Chat[]) {
  localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
  emit();
}

/* ─── Imperative store API (usable outside React) ─── */

export const chatStore = {
  list(storeId: string, filter: "open" | "archived" | "all" = "open"): Chat[] {
    return readChats()
      .filter((c) => c.storeId === storeId)
      .filter((c) => (filter === "all" ? true : c.status === filter))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  get(chatId: string): Chat | null {
    return readChats().find((c) => c.id === chatId) ?? null;
  },

  create(storeId: string, title?: string): Chat {
    const now = new Date().toISOString();
    const chat: Chat = {
      id: nanoid(10),
      title: title ?? null,
      storeId,
      status: "open",
      createdAt: now,
      updatedAt: now,
    };
    writeChats([chat, ...readChats()]);
    return chat;
  },

  update(
    chatId: string,
    data: { title?: string; archive?: boolean; unarchive?: boolean },
  ) {
    const chats = readChats().map((c) => {
      if (c.id !== chatId) return c;
      const next: Chat = { ...c, updatedAt: new Date().toISOString() };
      if (data.title != null) next.title = data.title;
      if (data.archive) next.status = "archived";
      if (data.unarchive) next.status = "open";
      return next;
    });
    writeChats(chats);
  },

  touch(chatId: string, title?: string) {
    const chats = readChats().map((c) =>
      c.id === chatId
        ? {
            ...c,
            updatedAt: new Date().toISOString(),
            title: c.title ?? title ?? c.title,
          }
        : c,
    );
    writeChats(chats);
  },

  messages(chatId: string): StoredMessage[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(MSGS_PREFIX + chatId);
      return raw ? (JSON.parse(raw) as StoredMessage[]) : [];
    } catch {
      return [];
    }
  },

  setMessages(chatId: string, msgs: StoredMessage[]) {
    localStorage.setItem(MSGS_PREFIX + chatId, JSON.stringify(msgs));
    emit();
  },
};

/* ─── React bindings ─── */

export function useChats(storeId: string, filter: "open" | "archived" = "open") {
  const getSnapshot = useCallback(() => {
    return JSON.stringify(chatStore.list(storeId, filter));
  }, [storeId, filter]);

  const serialized = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => "[]",
  );

  const chats = JSON.parse(serialized) as Chat[];
  return { chats };
}
