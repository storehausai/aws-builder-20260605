"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Building2, TrendingUp, Users, Instagram, Send, Check, Loader2 } from "lucide-react";
import { outreach, type Visuals, type OutreachResult } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The visual research canvas — the agent's findings rendered with REAL images:
 * brand + competitor logos (Clearbit), a real BSR spike chart (recharts on the
 * engine's series), and real Instagram creator avatars. Each section animates in.
 * Images fall back to a clean monogram when a logo/avatar can't be fetched.
 */
export function ResearchCanvas({
  visuals,
  storeId,
  brand: brandName,
  onOutreach,
}: {
  visuals: Visuals;
  storeId?: string;
  brand?: string;
  onOutreach?: (handle: string, result: OutreachResult) => void;
}) {
  const { brand, competitors, chart, creators } = visuals;
  const hasChart = !!chart && chart.points.length > 2;
  let d = 0;
  const next = () => (d += 0.08);

  return (
    <div className="flex flex-col gap-3">
      {brand && (
        <Section icon={Building2} title="Brand" delay={next()}>
          <div className="flex items-center gap-3">
            <Logo src={brand.logo} name={brand.name} size={44} square />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">{brand.name}</div>
              {brand.category && <div className="text-xs text-muted-foreground">{brand.category}</div>}
            </div>
          </div>
        </Section>
      )}

      {competitors && competitors.length > 0 && (
        <Section icon={Building2} title={`Competitors (${competitors.length})`} delay={next()}>
          <div className="flex flex-wrap gap-2">
            {competitors.map((c) => (
              <div key={c.name} className="flex items-center gap-1.5 rounded-full border border-border bg-background py-1 pl-1 pr-2.5">
                <Logo src={c.logo} name={c.name} size={20} square />
                <span className="text-xs font-medium text-foreground">{c.name}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {hasChart && (
        <Section icon={TrendingUp} title="Amazon sales-rank — bursts detected" delay={next()}>
          {chart!.productTitle && (
            <div className="mb-1.5 truncate text-xs text-muted-foreground">{chart!.productTitle}</div>
          )}
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart!.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <XAxis dataKey="date" hide />
                {/* lower rank = better → reverse so a burst spikes UP */}
                <YAxis reversed domain={["dataMin", "dataMax"]} hide />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid var(--color-border)" }}
                  formatter={(v: number) => [`#${v}`, "BSR"]}
                  labelFormatter={(l) => String(l)}
                />
                <Line
                  type="monotone"
                  dataKey="rank"
                  stroke="var(--color-foreground)"
                  strokeWidth={1.75}
                  dot={<SpikeDot />}
                  activeDot={{ r: 3 }}
                  isAnimationActive
                  animationDuration={900}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" /> burst (steady price → real demand)
          </div>
        </Section>
      )}

      {creators && creators.length > 0 && (
        <Section icon={Users} title={`Creators (${creators.length})`} delay={next()}>
          <div className="grid grid-cols-1 gap-2">
            {creators.map((c, i) => (
              <CreatorRow
                key={c.handle}
                c={c}
                i={i}
                storeId={storeId}
                brand={brandName}
                onOutreach={onOutreach}
              />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function CreatorRow({
  c,
  i,
  storeId,
  brand,
  onOutreach,
}: {
  c: NonNullable<Visuals["creators"]>[number];
  i: number;
  storeId?: string;
  brand?: string;
  onOutreach?: (handle: string, result: OutreachResult) => void;
}) {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  async function dm() {
    setState("sending");
    try {
      const r = await outreach({ handle: c.handle, brand, storeId });
      onOutreach?.(c.handle, r);
      setState("done");
    } catch {
      setState("idle");
    }
  }
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.05 * i, duration: 0.25 }}
      className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2"
    >
      <Logo src={c.avatar} name={c.handle} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-sm font-medium text-foreground">
          <Instagram className="h-3 w-3 text-muted-foreground" />@{c.handle}
        </div>
        {c.followers != null && (
          <div className="text-xs text-muted-foreground">{fmtFollowers(c.followers)} followers</div>
        )}
      </div>
      {c.score != null && (
        <span className="flex-shrink-0 text-xs font-semibold tabular-nums text-foreground">{Math.round(c.score * 100)}</span>
      )}
      <button
        onClick={dm}
        disabled={state !== "idle"}
        className="inline-flex h-7 flex-shrink-0 items-center gap-1 rounded-lg bg-foreground px-2.5 text-xs font-medium text-background transition-opacity disabled:opacity-60"
      >
        {state === "sending" ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" /> …
          </>
        ) : state === "done" ? (
          <>
            <Check className="h-3 w-3" /> Sent
          </>
        ) : (
          <>
            <Send className="h-3 w-3" /> DM
          </>
        )}
      </button>
    </motion.div>
  );
}

function Section({
  icon: Icon,
  title,
  delay,
  children,
}: {
  icon: typeof Building2;
  title: string;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
      className="rounded-2xl border border-border bg-surface-raised/40 p-3.5"
    >
      <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" /> {title}
      </div>
      {children}
    </motion.div>
  );
}

function Logo({ src, name, size = 40, square = false }: { src?: string; name: string; size?: number; square?: boolean }) {
  const [failed, setFailed] = useState(false);
  const initials = name.replace(/^@/, "").slice(0, 2).toUpperCase();
  const shape = square ? "rounded-lg" : "rounded-full";
  if (!src || failed) {
    return (
      <div
        className={cn("flex flex-shrink-0 items-center justify-center bg-foreground/[0.06] text-[10px] font-semibold text-muted-foreground ring-1 ring-border", shape)}
        style={{ width: size, height: size }}
      >
        {initials}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={cn("flex-shrink-0 bg-background object-cover ring-1 ring-border", shape)}
      style={{ width: size, height: size }}
    />
  );
}

const SpikeDot = (props: { cx?: number; cy?: number; payload?: { spike?: boolean } }) => {
  const { cx, cy, payload } = props;
  if (!payload?.spike || cx == null || cy == null) return <g />;
  return <circle cx={cx} cy={cy} r={4} fill="#ef4444" stroke="#fff" strokeWidth={1.5} />;
};

function fmtFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
