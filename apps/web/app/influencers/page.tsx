"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { Sidebar } from "@/components/seller/Sidebar";
import { InfluencerTable } from "@/components/influencers/InfluencerTable";
import { getCurrentStore } from "@/lib/current-store";
import { getInfluencers, type StoredInfluencer } from "@/lib/api";
import { NOTION_TEXT, NOTION_TEXT_MUTED } from "@/lib/colors";

export default function InfluencersPage() {
  const router = useRouter();
  const [storeId, setStoreId] = useState<string | null>(null);
  const [brandName, setBrandName] = useState<string>("");
  const [influencers, setInfluencers] = useState<StoredInfluencer[] | null>(
    null,
  );

  useEffect(() => {
    const s = getCurrentStore();
    if (!s) {
      router.replace("/");
      return;
    }
    setStoreId(s.storeId);
    setBrandName(s.brand?.name ?? "");
    getInfluencers(s.storeId)
      .then(setInfluencers)
      .catch(() => setInfluencers([]));
  }, [router]);

  if (!storeId) return null;

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <Sidebar
        storeId={storeId}
        activeItem="influencers"
        onNewChat={() => router.push("/chat")}
        onNavigateToTask={(id) => router.push(`/chat/${id}`)}
        onNavigateToDashboard={() => router.push("/dashboard")}
        onNavigateToInfluencers={() => {}}
        activeTaskId={null}
      />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-8 py-10">
          {/* Header */}
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-surface-raised text-foreground">
              <Users className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1
                className="text-2xl font-semibold tracking-tight"
                style={{ color: NOTION_TEXT }}
              >
                Influencers
              </h1>
              <p className="mt-1 text-sm" style={{ color: NOTION_TEXT_MUTED }}>
                Creators pebble surfaced for{" "}
                {brandName || "your store"}, ranked by market-mover fit.
                {influencers && influencers.length > 0
                  ? ` · ${influencers.length} total`
                  : ""}
              </p>
            </div>
          </div>

          {/* Table */}
          <div className="mt-8">
            {influencers === null ? (
              <TableSkeleton />
            ) : (
              <InfluencerTable influencers={influencers} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="h-9 bg-surface-raised/60" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-t border-border px-3 py-2.5"
        >
          <div className="h-6 w-6 flex-shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="h-3.5 w-40 animate-pulse rounded bg-muted" />
          <div className="ml-auto h-3.5 w-24 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
