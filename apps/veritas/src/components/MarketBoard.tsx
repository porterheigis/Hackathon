"use client";

import type { Market } from "@/lib/schemas";

function cents(p: number): string {
  return `${Math.round(p * 100)}¢`;
}

function compactVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

export function MarketBoard({ markets }: { markets: Market[] }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-v-bg">
      <div className="border-b border-v-hairline px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-v-muted">
        polymarket board · top 24h volume · live quotes
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {markets.length === 0 && (
          <div className="px-3 py-4 text-xs text-v-dim">no quotes yet</div>
        )}
        {markets.map((m) => (
          <div
            key={m.id}
            className="border-b border-v-hairline/50 px-3 py-1.5 hover:bg-v-panel"
          >
            <div className="truncate text-[11px] leading-snug text-v-text" title={m.question}>
              {m.question}
            </div>
            <div className="tabular mt-0.5 flex gap-3 text-[10px]">
              <span className="text-v-green">YES {cents(m.yesPrice)}</span>
              <span className="text-v-red">NO {cents(m.noPrice)}</span>
              <span className="ml-auto text-v-muted">vol {compactVol(m.volume24h)}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
