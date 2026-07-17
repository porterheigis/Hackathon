"use client";

import type { FundState } from "@/lib/types";
import { fmtPct } from "./format";

interface ScenarioPanelProps {
  state: FundState;
  promptText: string;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-atlas-hairline/40 px-3 py-2">
      <span className="font-mono text-[10px] tracking-[0.1em] text-atlas-muted uppercase">
        {label}
      </span>
      <span className="text-right font-mono text-[11px] text-atlas-text">{children}</span>
    </div>
  );
}

export function ScenarioPanel({ state, promptText }: ScenarioPanelProps) {
  const s = state.scenario;

  const nodeShock = s?.shocks
    ?.filter((sh) => sh.targetType === "node")
    .reduce((min, sh) => Math.min(min, sh.changePercent), 0);
  const edgeShock = s?.shocks
    ?.filter((sh) => sh.targetType === "edge")
    .reduce((min, sh) => Math.min(min, sh.changePercent), 0);

  const conf = state.parseConfidence;
  const isFallback = state.parseSource === "fallback";
  const promptShown = s?.prompt ?? promptText;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Original prompt */}
      <div className="border-b border-atlas-hairline px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9px] tracking-[0.12em] text-atlas-dim uppercase">
            Original Prompt
          </span>
          {isFallback && (
            <span className="rounded-sm border border-atlas-amber/50 px-1 py-0.5 font-mono text-[8px] tracking-[0.1em] text-atlas-amber uppercase">
              Fallback
            </span>
          )}
        </div>
        <p className="mt-1.5 font-sans text-[12px] leading-snug text-atlas-text">
          {promptShown || (
            <span className="text-atlas-dim">Awaiting scenario input…</span>
          )}
        </p>
      </div>

      {s ? (
        <>
          <Row label="Parsed Event">
            <span className="text-atlas-bright">{s.title}</span>
          </Row>
          <Row label="Event Type">{s.eventType}</Row>
          <Row label="Industry">{s.industry}</Row>
          <Row label="Company">{s.targetCompany}</Row>
          <Row label="Duration">{s.durationDays}d</Row>
          <Row label="Horizon">{s.horizonDays}d</Row>
          <Row label="Production Shock">
            <span className={nodeShock && nodeShock < 0 ? "text-atlas-red" : ""}>
              {nodeShock ? fmtPct(nodeShock, 0, true) : "—"}
            </span>
          </Row>
          <Row label="Logistics Shock">
            <span className={edgeShock && edgeShock < 0 ? "text-atlas-amber" : ""}>
              {edgeShock ? fmtPct(edgeShock, 0, true) : "—"}
            </span>
          </Row>
          <Row label="Confidence">
            <span
              className={
                conf >= 0.75
                  ? "text-atlas-green"
                  : conf >= 0.5
                    ? "text-atlas-amber"
                    : "text-atlas-red"
              }
            >
              {fmtPct(conf * 100, 0)}
            </span>
          </Row>
          <Row label="Source">
            <span className="uppercase tracking-[0.1em] text-atlas-muted">
              {state.parseSource} · {s.source}
            </span>
          </Row>
          {state.secondaryShockApplied && (
            <div className="px-3 py-2">
              <span className="rounded-sm border border-atlas-red/40 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-atlas-red uppercase">
                Secondary shock applied · Japan
              </span>
            </div>
          )}
        </>
      ) : (
        <div className="px-3 py-6 font-mono text-[11px] text-atlas-dim">
          No scenario parsed yet. Compose a disruption and press Run.
        </div>
      )}
    </div>
  );
}
