"use client";

import { markToMarket, type PortfolioSnapshot } from "@/lib/portfolio";
import { Sparkline } from "./Sparkline";

function cents(p: number): string {
  return `${Math.round(p * 100)}¢`;
}

export function PositionBook({
  portfolio,
  pnlHistory,
}: {
  portfolio: PortfolioSnapshot | null;
  pnlHistory: number[];
}) {
  const positions = portfolio?.positions ?? [];
  const denials = portfolio?.denials ?? [];

  return (
    <section className="hud-panel relative flex min-h-0 flex-1 flex-col">
      <i className="hud-corner hud-corner-tl" />
      <i className="hud-corner hud-corner-br" />
      <div className="eyebrow flex items-center border-b border-v-hairline px-3 py-2">
        position book · mark-to-market
        <span className="ml-auto">
          <Sparkline values={pnlHistory} />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {positions.length === 0 && denials.length === 0 && (
          <div className="px-3 py-4 text-xs text-v-dim">flat — no positions this session</div>
        )}
        {positions.map((p) => {
          const pnl = markToMarket(p.sizeUsd, p.entryPrice, p.currentPrice);
          const pnlColor = pnl > 0 ? "text-v-green" : pnl < 0 ? "text-v-red" : "text-v-muted";
          return (
            <div key={p.id} className="border-b border-v-hairline/50 px-3 py-2">
              <div className="truncate text-[11px] text-v-text" title={p.question}>
                {p.question}
              </div>
              <div className="tabular mt-0.5 flex gap-3 text-[10px]">
                <span className={p.side === "YES" ? "text-v-green" : "text-v-red"}>
                  {p.side} ${p.sizeUsd.toFixed(2)}
                </span>
                <span className="text-v-muted">
                  {cents(p.entryPrice)} → {cents(p.currentPrice)}
                </span>
                <span className={`ml-auto ${pnlColor}`}>
                  {pnl >= 0 ? "+" : ""}
                  {pnl.toFixed(2)}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[10px] italic text-v-dim" title={p.thesis}>
                {p.thesis}
              </div>
            </div>
          );
        })}
        {denials.map((d) => (
          <div key={d.id} className="border-b border-v-hairline/50 px-3 py-1.5 opacity-70">
            <div className="truncate text-[11px] text-v-red line-through" title={d.question}>
              {d.side} ${d.sizeUsd.toFixed(2)} — {d.question}
            </div>
            <div className="text-[10px] uppercase tracking-[0.15em] text-v-red/70">
              denied · {d.reason} · {d.source}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
