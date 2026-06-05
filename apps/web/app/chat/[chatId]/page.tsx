"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChatWorkspace } from "@/components/chat/ChatWorkspace";
import { getCurrentStore, type CurrentStore } from "@/lib/current-store";

function ExistingChat() {
  const router = useRouter();
  const params = useParams();
  const chatId =
    typeof params.chatId === "string"
      ? params.chatId
      : Array.isArray(params.chatId)
        ? params.chatId[0]!
        : null;

  const [store, setStore] = useState<CurrentStore | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const s = getCurrentStore();
    if (!s) {
      router.replace("/");
    } else {
      setStore(s);
    }
    setChecked(true);
  }, [router]);

  if (!checked || !store) return null;
  return (
    <ChatWorkspace
      storeId={store.storeId}
      brand={store.brand?.name}
      initialChatId={chatId}
      initialSeed={null}
    />
  );
}

export default function ChatIdPage() {
  return (
    <Suspense fallback={null}>
      <ExistingChat />
    </Suspense>
  );
}
