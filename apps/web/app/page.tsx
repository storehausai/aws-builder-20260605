"use client";

import { useEffect, useState } from "react";
import { ChatWorkspace } from "@/components/chat/ChatWorkspace";

/**
 * Landing = the chat itself. No URL-import step and no blank-page form: the user
 * starts in a chat with suggestion pills, and when a pill needs a brand the
 * agent simply ASKS for the store's homepage and onboards from it on the fly
 * (find_influencers accepts a brandUrl). One less screen, zero friction.
 *
 * Mount-gated (like /chat) because ChatWorkspace touches localStorage in a
 * useState initializer, which would crash static prerendering.
 */
export default function Home() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <ChatWorkspace storeId="" initialChatId={null} initialSeed={null} />;
}
