"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChatWorkspace } from "@/components/chat/ChatWorkspace";
import { getCurrentStore, type CurrentStore } from "@/lib/current-store";

function NewChat() {
  const router = useRouter();
  const params = useSearchParams();
  const seed = params.get("seed");
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
      initialChatId={null}
      initialSeed={seed}
    />
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <NewChat />
    </Suspense>
  );
}
