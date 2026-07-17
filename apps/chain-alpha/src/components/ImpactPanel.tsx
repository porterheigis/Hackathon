"use client";

import type { FundState } from "@/lib/types";
import {
  directionGlyph,
  fmtDays,
  fmtPct,
  fmtRange,
  fmtUsdCompact,
  fmtUsdSigned,
  severityColor,
} from "./format";

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-atlas-hairline/40 border-r px-3 py-2">
      <span className="font-mono text-[9px] tracking-[0.08em] text-atlas-dim uppercase">
        {label}
      </span>
      <span className={`font-mono text-[13px] tabular ${tone ?? "text-atlas-text"}`}>
        {value}
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-atlas-hairline bg-atlas-bg px-3 py-1.5 font-mono text-[9px] tracking-[0.15em] text-atlas-muted uppercase">
      {children}
    </div>
  );
}

export function ImpactPanel({ state }: { state: FundState }) {
  const op = state.operational;
  const fin = state.financial;
  const companies = state.companies;
  const transport = state.transportImpact;

  if (!op && !fin && companies.length === 0 && !transport) {
    return (
      <div className="flex flex-1 items-center justify-center px-3 py-6 text-center font-mono text-[11px] text-atlas-dim">
        Impact model runs after SIMULATE. Press Run to generate scenario estimates.
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Operational */}
      {op && (
        <>
          <SectionLabel>Operational Impact</SectionLabel>
          <div className="grid grid-cols-2">
            <Metric
              label="Supply Reduction"
              value={fmtPct(op.supplyReductionPercent, 0)}
              tone="text-atlas-red"
            />
            <Metric label="Delivery Delay" value={fmtDays(op.deliveryDelayDays)} tone="text-atlas-amber" />
            <Metric label="Inventory Coverage" value={fmtDays(op.inventoryCoverageDays)} />
            <Metric
              label="Shortage Prob."
              value={fmtPct(op.shortageProbability * 100, 0)}
              tone={op.shortageProbability > 0.5 ? "text-atlas-red" : "text-atlas-amber"}
            />
            <Metric
              label="Recovery Window"
              value={`${op.recoveryMinDays}–${op.recoveryMaxDays}d`}
            />
            <Metric label="Est. Basis" value="scenario" tone="text-atlas-dim" />
          </div>
        </>
      )}

      {/* Transport impact (observed vessels/aircraft) */}
      {transport && (
        <>
          <SectionLabel>Transport Impact</SectionLabel>
          <div className="grid grid-cols-2">
            <Metric
              label="Observed Vessel Exposure"
              value={String(transport.exposedVesselCount)}
              tone={transport.exposedVesselCount > 0 ? "text-atlas-amber" : "text-atlas-text"}
            />
            <Metric
              label="Observed Aircraft Exposure"
              value={String(transport.exposedAircraftCount)}
              tone={transport.exposedAircraftCount > 0 ? "text-atlas-amber" : "text-atlas-text"}
            />
            <Metric
              label="Est. Maritime Delay"
              value={
                transport.medianReroutingDelayDays === null
                  ? "n/a"
                  : fmtDays(transport.medianReroutingDelayDays)
              }
              tone="text-atlas-amber"
            />
            <Metric
              label="Est. Air Capacity Cut"
              value={
                transport.estimatedAirCapacityReductionPercent === null
                  ? "n/a"
                  : `${transport.estimatedAirCapacityReductionPercent.min.toFixed(0)}–${transport.estimatedAirCapacityReductionPercent.max.toFixed(0)}%`
              }
              tone={
                transport.estimatedAirCapacityReductionPercent === null
                  ? "text-atlas-dim"
                  : "text-atlas-red"
              }
            />
            <Metric
              label="Est. Maritime Capacity"
              value={
                transport.estimatedMaritimeCapacityExposure === null
                  ? "n/a"
                  : `${Math.round(transport.estimatedMaritimeCapacityExposure.min)}–${Math.round(transport.estimatedMaritimeCapacityExposure.max)} ${transport.estimatedMaritimeCapacityExposure.unit}`
              }
              tone={
                transport.estimatedMaritimeCapacityExposure === null
                  ? "text-atlas-dim"
                  : "text-atlas-text"
              }
            />
            <Metric
              label="Confidence"
              value={fmtPct(transport.confidence * 100, 0)}
              tone={transport.confidence >= 0.7 ? "text-atlas-green" : "text-atlas-amber"}
            />
          </div>
          <div className="px-3 py-1.5 font-mono text-[9px] leading-relaxed text-atlas-dim">
            Observed vessels/aircraft near the affected region. Scenario estimates —
            capacities shown as ranges, or n/a when class data is unavailable.
          </div>
        </>
      )}

      {/* Company table */}
      {companies.length > 0 && (
        <>
          <SectionLabel>Company Impact</SectionLabel>
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-atlas-hairline/60 px-3 py-1 font-mono text-[9px] tracking-[0.08em] text-atlas-dim uppercase">
            <span>Company</span>
            <span>Severity</span>
            <span className="text-right">Rev. Impact</span>
          </div>
          {companies.map((c) => {
            const d = directionGlyph(c.direction);
            return (
              <div
                key={c.companyId}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-atlas-hairline/40 px-3 py-1.5"
                title={c.reason}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`${d.color} text-[11px] leading-none`}>{d.glyph}</span>
                  <span className="font-mono text-[11px] text-atlas-bright">{c.companyName}</span>
                </div>
                <span className={`font-mono text-[10px] uppercase ${severityColor(c.severity)}`}>
                  {c.severity}
                </span>
                <span className="text-right font-mono text-[10px] tabular text-atlas-text">
                  {fmtRange(c.revenueImpactMinUsd, c.revenueImpactMaxUsd, fmtUsdCompact)}
                </span>
              </div>
            );
          })}
        </>
      )}

      {/* Financial */}
      {fin && (
        <>
          <SectionLabel>Financial Estimate</SectionLabel>
          <div className="grid grid-cols-2">
            <Metric
              label="Revenue at Risk"
              value={fmtRange(fin.revenueAtRiskMinUsd, fin.revenueAtRiskMaxUsd, fmtUsdCompact)}
              tone="text-atlas-red"
            />
            <Metric
              label="Gross Margin"
              value={`${fin.grossMarginImpactMinPoints.toFixed(1)}–${fin.grossMarginImpactMaxPoints.toFixed(1)} pts`}
              tone="text-atlas-amber"
            />
            <Metric
              label="Est. Market Move"
              value={`${fmtPct(fin.estimatedMarketMoveMinPercent, 1, true)} · ${fmtPct(fin.estimatedMarketMoveMaxPercent, 1, true)}`}
            />
            <Metric
              label="Portfolio P&L"
              value={state.pnlUsd === 0 ? "$0" : fmtUsdSigned(state.pnlUsd)}
              tone={state.pnlUsd > 0 ? "text-atlas-green" : state.pnlUsd < 0 ? "text-atlas-red" : "text-atlas-dim"}
            />
            <Metric
              label="Confidence"
              value={fmtPct(fin.confidence * 100, 0)}
              tone={fin.confidence >= 0.7 ? "text-atlas-green" : "text-atlas-amber"}
            />
            <Metric label="Basis" value="estimates" tone="text-atlas-dim" />
          </div>

          {fin.assumptions.length > 0 && (
            <div className="px-3 py-2">
              <span className="font-mono text-[9px] tracking-[0.1em] text-atlas-dim uppercase">
                Sensitive Assumptions
              </span>
              <div className="mt-1 flex flex-col gap-1">
                {fin.assumptions.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2">
                    <span className="font-sans text-[11px] text-atlas-text">{a.label}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] tabular text-atlas-muted">{a.value}</span>
                      <span
                        className={`font-mono text-[8px] uppercase tracking-[0.1em] ${
                          a.sensitivity === "high"
                            ? "text-atlas-red"
                            : a.sensitivity === "medium"
                              ? "text-atlas-amber"
                              : "text-atlas-dim"
                        }`}
                      >
                        {a.sensitivity}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="px-3 py-2 font-mono text-[9px] leading-relaxed text-atlas-dim">
        All figures are scenario estimates, not forecasts or advice.
      </div>
    </div>
  );
}
