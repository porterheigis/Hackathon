"use client";

import type { PortfolioPosition } from "@/lib/types";
import { directionGlyph, fmtPct, fmtUsdCompact, fmtUsdSigned, severityColor } from "./format";

interface PortfolioExposurePanelProps {
  portfolio: PortfolioPosition[];
  pnlUsd: number;
}

/** Canonical display order + fallback rows so the panel is never empty. */
const SEED: PortfolioPosition[] = [
  { id: "NVDA", name: "NVIDIA", exposureUsd: 4200000, portfolioPercent: 34.0, direction: "neutral", severity: "none" },
  { id: "AMD", name: "AMD", exposureUsd: 1650000, portfolioPercent: 13.4, direction: "neutral", severity: "none" },
  { id: "TSM", name: "TSMC", exposureUsd: 2400000, portfolioPercent: 19.4, direction: "neutral", severity: "none" },
  { id: "INTC", name: "Intel", exposureUsd: 1100000, portfolioPercent: 8.9, direction: "neutral", severity: "none" },
  { id: "ASML", name: "ASML", exposureUsd: 1450000, portfolioPercent: 11.7, direction: "neutral", severity: "none" },
  { id: "SOXX", name: "SOXX", exposureUsd: 1550000, portfolioPercent: 12.6, direction: "neutral", severity: "none" },
];

export function PortfolioExposurePanel({ portfolio, pnlUsd }: PortfolioExposurePanelProps) {
  const rows = portfolio.length ? portfolio : SEED;
  const totalExposure = rows.reduce((s, r) => s + r.exposureUsd, 0);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-atlas-hairline px-3 py-2">
        <span className="font-mono text-[10px] tracking-[0.15em] text-atlas-muted uppercase">
          Portfolio Exposure
        </span>
        <span className="font-mono text-[10px] tabular text-atlas-dim">
          {fmtUsdCompact(totalExposure)}
        </span>
      </div>

      {/* Column header */}
      <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-atlas-hairline/60 px-3 py-1.5 font-mono text-[9px] tracking-[0.1em] text-atlas-dim uppercase">
        <span>Asset</span>
        <span className="text-right">Exposure</span>
        <span className="w-7 text-right">%</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((r) => {
          const d = directionGlyph(r.direction);
          return (
            <div
              key={r.id}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-atlas-hairline/40 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className={`${d.color} text-[11px] leading-none`}>{d.glyph}</span>
                <div className="flex flex-col leading-tight">
                  <span className="font-mono text-[12px] text-atlas-bright">{r.name}</span>
                  <span className={`font-mono text-[9px] uppercase tracking-[0.1em] ${severityColor(r.severity)}`}>
                    {r.severity === "none" ? "no impact" : r.severity}
                  </span>
                </div>
              </div>
              <span className="text-right font-mono text-[12px] tabular text-atlas-text">
                {fmtUsdCompact(r.exposureUsd)}
              </span>
              <span className="w-7 text-right font-mono text-[11px] tabular text-atlas-muted">
                {r.portfolioPercent.toFixed(0)}
              </span>
            </div>
          );
        })}
      </div>

      {/* P&L footer */}
      <div className="flex items-center justify-between border-t border-atlas-hairline px-3 py-2">
        <span className="font-mono text-[10px] tracking-[0.12em] text-atlas-muted uppercase">
          Scenario P&amp;L
        </span>
        <span
          className={`font-mono text-[13px] tabular ${
            pnlUsd > 0 ? "text-atlas-green" : pnlUsd < 0 ? "text-atlas-red" : "text-atlas-dim"
          }`}
        >
          {pnlUsd === 0 ? "$0" : fmtUsdSigned(pnlUsd)}
        </span>
      </div>
      <div className="px-3 pb-2 font-mono text-[9px] text-atlas-dim">
        direction &amp; severity are scenario estimates · {fmtPct(100, 0)} paper
      </div>
    </div>
  );
}
