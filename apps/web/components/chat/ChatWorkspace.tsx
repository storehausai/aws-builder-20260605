"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sidebar } from "@/components/seller/Sidebar";
import { ChatView } from "@/components/seller/panels/chat/ChatView";
import { chatStore } from "@/lib/chat-store";
import type { OutreachResult } from "@/lib/api";

/**
 * The chat workspace shell: pebble's cloned Sidebar (left) + a resizable
 * two-pane split of ChatView (conversation) and PanelHost (the agent's panel).
 * Selecting / creating chats updates the URL via replaceState so a chat never
 * remounts mid-stream (ChatView is keyed by chatId for a clean per-chat mount).
 */
export function ChatWorkspace({
  storeId,
  brand,
  initialChatId,
  initialSeed,
}: {
  storeId: string;
  brand?: string;
  initialChatId: string | null;
  initialSeed?: string | null;
}) {
  const router = useRouter();
  const createdRef = useRef<string | null>(null);

  const [selectedChatId, setSelectedChatId] = useState<string>(() => {
    if (initialChatId) return initialChatId;
    if (createdRef.current) return createdRef.current;
    const c = chatStore.create(storeId);
    createdRef.current = c.id;
    return c.id;
  });
  const [seed, setSeed] = useState<string | null>(initialSeed ?? null);

  const syncUrl = (id: string) => {
    if (typeof window !== "undefined") window.history.replaceState(null, "", `/chat/${id}`);
  };

  const onNewChat = useCallback(() => {
    const c = chatStore.create(storeId);
    setSelectedChatId(c.id);
    setSeed(null);
    syncUrl(c.id);
  }, [storeId]);

  const onSelect = useCallback((id: string) => {
    setSelectedChatId(id);
    setSeed(null);
    syncUrl(id);
  }, []);

  const onOutreach = useCallback((handle: string, result: OutreachResult) => {
    if (result.needsConnection === "instagram") {
      toast.warning(`Connect Instagram to DM @${handle}`, { description: result.message.slice(0, 90) });
    } else if (result.delivered) {
      toast.success(`DM sent to @${handle}`);
    } else {
      toast(`Drafted DM to @${handle}`, { description: result.message.slice(0, 90) });
    }
  }, []);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <Sidebar
        storeId={storeId}
        activeItem="chat"
        onNewChat={onNewChat}
        onNavigateToTask={onSelect}
        onNavigateToDashboard={() => router.push("/dashboard")}
        onNavigateToInfluencers={() => router.push("/influencers")}
        onUpdateChat={(id, data) => chatStore.update(id, data)}
        activeTaskId={selectedChatId}
      />
      <div className="min-w-0 flex-1">
        <ChatView
          key={selectedChatId}
          chatId={selectedChatId}
          storeId={storeId}
          brand={brand}
          seed={seed}
          onOutreach={onOutreach}
        />
      </div>
    </div>
  );
}
