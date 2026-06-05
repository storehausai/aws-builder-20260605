"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Star, Flame, Megaphone, TrendingUp, ArrowUpRight, Building2 } from "lucide-react";
import { Sidebar } from "@/components/seller/Sidebar";
import { getCurrentStore } from "@/lib/current-store";
import { getBrand, type BrandInfo } from "@/lib/api";

const EXAMPLES = [
  {
    icon: Star,
    title: "Find market movers",
    body: "Surface the creators who actually drove sales — not vanity reach.",
    prompt: "Find influencers who can move my market",
    primary: true,
  },
  {
    icon: Flame,
    title: "Competitor bursts",
    body: "See which creators moved my competitors' Amazon rank.",
    prompt: "Who drove my competitors' sales bursts?",
  },
  {
    icon: Megaphone,
    title: "Draft outreach",
    body: "Write personalized DMs to my top creator picks.",
    prompt: "Draft outreach DMs to my top creators",
  },
  {
    icon: TrendingUp,
    title: "Rank trend",
    body: "How is my flagship product trending on Amazon?",
    prompt: "How is my Amazon sales rank trending?",
  },
];

export default function DashboardPage() {
  const router = useRouter();
  const [storeId, setStoreId] = useState<string | null>(null);
  const [brand, setBrand] = useState<BrandInfo | null>(null);

  useEffect(() => {
    const s = getCurrentStore();
    if (!s) {
      router.replace("/");
      return;
    }
    setStoreId(s.storeId);
    setBrand(s.brand);
    getBrand(s.storeId)
      .then((b) => setBrand((prev) => ({ ...prev, ...b })))
      .catch(() => {});
  }, [router]);

  if (!storeId || !brand) return null;

  const start = (prompt: string) => router.push(`/chat?seed=${encodeURIComponent(prompt)}`);
  const competitors = brand.competitors ?? [];
  const asins = brand.seedAsins ?? [];

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <Sidebar
        storeId={storeId}
        activeItem="dashboard"
        onNewChat={() => router.push("/chat")}
        onNavigateToTask={(id) => router.push(`/chat/${id}`)}
        onNavigateToDashboard={() => {}}
        onNavigateToInfluencers={() => router.push("/influencers")}
        activeTaskId={null}
      />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-8 py-10">
          {/* Brand header */}
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-surface-raised text-foreground">
              <Building2 className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">{brand.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {brand.category && (
                  <span className="rounded-full bg-surface-raised px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {brand.category}
                  </span>
                )}
                {brand.brandUrl && (
                  <a
                    href={brand.brandUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {hostOf(brand.brandUrl)} <ArrowUpRight className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          </div>

          {brand.summary && (
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{brand.summary}</p>
          )}

          {/* Quick facts */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-2">
            <Fact label="Competitors mapped" value={String(competitors.length)} hint={competitors.slice(0, 3).join(" · ")} />
            <Fact label="Products on Amazon" value={String(asins.length)} hint={asins.slice(0, 3).join(" · ") || "—"} />
          </div>

          {/* Examples */}
          <div className="mt-10">
            <h2 className="text-sm font-semibold text-foreground">Start an analysis</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Pick one and pebble gets to work — you'll watch it think.</p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.title}
                  onClick={() => start(ex.prompt)}
                  className={`group flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-colors ${
                    ex.primary
                      ? "border-foreground/15 bg-surface-raised hover:border-foreground/30"
                      : "border-border bg-background hover:bg-surface-raised"
                  }`}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background text-foreground ring-1 ring-border">
                    <ex.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1 text-sm font-medium text-foreground">
                      {ex.title}
                      <ArrowUpRight className="h-3.5 w-3.5 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                    </div>
                    <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{ex.body}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised/50 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold text-foreground">{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}
