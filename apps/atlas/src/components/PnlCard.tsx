"use client";

import type { FundState } from "@/lib/types";

interface PnlCardProps {
  state: FundState;
  onOpen: () => void;
}

function pnlSeries(state: FundState) {
  const values = [0];
  let running = 0;
  for (const position of state.positions) {
    if (position.kind === "fill") running += (position.size_usd ?? 0) * 0.05;
    if (position.kind === "pnl") running += position.pnl_usd ?? 0;
    values.push(running);
  }
  if (state.selectedMarket && state.approvedSize) {
    running += (state.selectedMarket.edge ?? 0) * state.approvedSize * 0.35;
    values.push(running);
  }
  while (values.length < 9) values.splice(1, 0, 0);
  return values.slice(-12);
}

function sparkPath(values: number[]) {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0.01);
  const spread = Math.max(max - min, 0.01);
  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 220;
      const y = 68 - ((value - min) / spread) * 54;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function PnlCard({ state, onOpen }: PnlCardProps) {
  const series = pnlSeries(state);
  const pnl = series[series.length - 1] ?? 0;
  const positive = pnl >= 0;

  return (
    <button type="button" className="pnl-card hud-panel" onClick={onOpen}>
      <span className="hud-kicker">Live P&amp;L · Mark</span>
      <strong className={positive ? "is-positive" : "is-negative"}>
        {positive ? "+" : "−"}${Math.abs(pnl).toFixed(2)}
      </strong>
      <svg className="pnl-spark" viewBox="0 0 220 76" role="img" aria-label="Mark P and L trend">
        <defs>
          <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={positive ? "#31d9a0" : "#ff5a4f"} stopOpacity=".28" />
            <stop offset="1" stopColor={positive ? "#31d9a0" : "#ff5a4f"} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${sparkPath(series)} L220,76 L0,76 Z`} fill="url(#pnlFill)" />
        <path d={sparkPath(series)} fill="none" stroke={positive ? "#31d9a0" : "#ff5a4f"} strokeWidth="2" />
      </svg>
      <span className="pnl-today">Today · Open fund details</span>
    </button>
  );
}
