"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Globe } from "lucide-react";
import { onboard } from "@/lib/api";
import { setCurrentStore } from "@/lib/current-store";

/**
 * Landing — a single job: import a brand homepage URL. No demo/try buttons.
 * On submit we onboard (real homepage read + AI extraction), persist the brand
 * to Butterbase, then open the brand dashboard.
 */
export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw = url.trim();
    if (!raw) return;
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setLoading(true);
    setError(null);
    try {
      const r = await onboard(normalized);
      setCurrentStore({
        storeId: r.storeId,
        brand: { ...r.brand, storeId: r.storeId, brandUrl: normalized },
      });
      router.push("/dashboard");
    } catch (err) {
      setError((err as Error).message || "Couldn't read that site — try another URL.");
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-background px-6">
      <div className="w-full max-w-xl">
        <div className="mb-10 text-center">
          <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground text-background">
            <span className="text-lg font-bold">p</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">pebble</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            Point pebble at your store. It finds the creators who actually move your
            market — and reaches out for you.
          </p>
        </div>

        {loading ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface-raised px-6 py-10 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-foreground" />
            <p className="text-sm font-medium text-foreground">Reading {hostOf(url)}…</p>
            <p className="text-xs text-muted-foreground">
              Identifying your brand, category, and competitors — this takes a few seconds.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface-raised px-4 py-1 shadow-sm focus-within:border-foreground/30">
              <Globe className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="your-brand.com"
                className="h-12 flex-1 bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!url.trim()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-medium text-background transition-opacity disabled:opacity-40"
              >
                Import <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            {error && <p className="px-1 text-sm text-red-500">{error}</p>}
            <p className="px-1 text-xs text-muted-foreground">
              e.g. getrael.com — a US storefront homepage.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}

function hostOf(u: string): string {
  try {
    return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "");
  } catch {
    return "your homepage";
  }
}
