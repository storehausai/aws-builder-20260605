"use client";

import { useRef, useState } from "react";
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
          {/* product info: image + title + competitor + rank jump + price */}
          {(chart!.productTitle || chart!.productImage) && (
            <div className="mb-2 flex items-center gap-2.5 rounded-lg border border-border bg-background p-2">
              {chart!.productImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={chart!.productImage} alt="" className="h-12 w-12 flex-shrink-0 rounded-md object-cover ring-1 ring-border" />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-foreground">{chart!.productTitle}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                  {chart!.competitor && <span>competitor · <span className="font-medium text-foreground">{chart!.competitor}</span></span>}
                  {chart!.rankFrom != null && chart!.rankTo != null && (
                    <span>rank <span className="font-medium text-foreground">#{chart!.rankFrom.toLocaleString()} → #{chart!.rankTo.toLocaleString()}</span></span>
                  )}
                  {(() => {
                    const last = [...(chart!.points ?? [])].reverse().find((p) => p.price != null);
                    return last?.price != null ? <span>${Number(last.price).toFixed(2)}</span> : null;
                  })()}
                </div>
              </div>
            </div>
          )}
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart!.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <XAxis dataKey="date" hide />
                {/* lower rank = better → reverse so a burst spikes UP */}
                <YAxis yAxisId="rank" reversed domain={["dataMin", "dataMax"]} hide />
                {/* Price on its own (right) scale. Pad the domain so a STEADY
                    (constant) price still renders as a centered, visible flat
                    line — "auto" collapses a min===max series to an edge and it
                    disappears. With [v·0.6, v·1.4] a constant value sits at 50%. */}
                <YAxis
                  yAxisId="price"
                  orientation="right"
                  domain={[(min: number) => +(min * 0.6).toFixed(2), (max: number) => +(max * 1.4).toFixed(2)]}
                  hide
                />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid var(--color-border)" }}
                  formatter={(v: number, name: string) =>
                    name === "price" ? [`$${Number(v).toFixed(2)}`, "Price"] : [`#${v}`, "BSR"]
                  }
                  labelFormatter={(l) => String(l)}
                />
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="price"
                  stroke="#16a34a"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  activeDot={{ r: 3 }}
                  connectNulls
                  isAnimationActive
                  animationDuration={900}
                />
                <Line
                  yAxisId="rank"
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
          <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-red-500" /> burst (steady price → real demand)</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: "repeating-linear-gradient(90deg,#16a34a 0 4px,transparent 4px 7px)" }} /> price (USD)</span>
          </div>
        </Section>
      )}

      {creators && creators.length > 0 && (
        <Section icon={Users} title={`Top reels (${creators.length})`} delay={next()}>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {creators.map((c, i) => (
              <ReelCard
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

function ReelCard({
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
  const [thumbFailed, setThumbFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

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

  function onEnter() {
    const v = videoRef.current;
    if (v) void v.play().catch(() => {});
  }
  function onLeave() {
    const v = videoRef.current;
    if (v) { v.pause(); try { v.currentTime = 0; } catch { /* noop */ } }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 * i, duration: 0.25 }}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-background"
    >
      {/* reel (9:16): thumbnail, plays on hover */}
      <a
        href={c.postUrl || `https://www.instagram.com/${c.handle}/`}
        target="_blank"
        rel="noreferrer"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        className="relative block aspect-[9/16] w-full overflow-hidden bg-muted"
      >
        {c.thumbnailUrl && !thumbFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={c.thumbnailUrl}
            alt={`@${c.handle} reel`}
            onError={() => setThumbFailed(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-foreground/[0.06] text-xs font-semibold text-muted-foreground">
            @{c.handle.replace(/^@/, "")}
          </div>
        )}
        {c.videoUrl && (
          <video
            ref={videoRef}
            src={c.videoUrl}
            muted
            loop
            playsInline
            preload="none"
            className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          />
        )}
        {c.score != null && (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white backdrop-blur-sm">
            {Math.round(c.score * 100)}
          </span>
        )}
      </a>

      {/* footer: avatar + followers + DM */}
      <div className="flex items-center gap-2 p-2">
        <Logo src={c.avatar} name={c.handle} size={28} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">@{c.handle}</div>
          {c.followers != null && (
            <div className="text-[11px] text-muted-foreground">{fmtFollowers(c.followers)} followers</div>
          )}
        </div>
        <button
          onClick={dm}
          disabled={state !== "idle"}
          className="inline-flex h-7 flex-shrink-0 items-center gap-1 rounded-lg bg-foreground px-2.5 text-xs font-medium text-background transition-opacity disabled:opacity-60"
        >
          {state === "sending" ? (
            <><Loader2 className="h-3 w-3 animate-spin" /> …</>
          ) : state === "done" ? (
            <><Check className="h-3 w-3" /> Sent</>
          ) : (
            <><Send className="h-3 w-3" /> DM</>
          )}
        </button>
      </div>
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
