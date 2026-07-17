"use client";

import type { FundState, PipelineStage } from "@/lib/types";

interface TelemetryStripProps {
  telemetry: FundState["telemetry"];
  stage: PipelineStage;
}

export function TelemetryStrip({ telemetry, stage }: TelemetryStripProps) {
  return (
    <footer className="flex h-9 shrink-0 items-center gap-6 overflow-x-auto border-t border-atlas-hairline px-4 font-mono text-[10px] tracking-[0.1em] text-atlas-muted uppercase">
      <span>
        Zero spend{" "}
        <span className="tabular text-atlas-text">
          ${telemetry.zeroSpendUsd.toFixed(2)}
        </span>
      </span>
      <span>
        Nexla calls{" "}
        <span className="tabular text-atlas-text">{telemetry.nexlaToolCalls}</span>
      </span>
      <span>
        Pomerium{" "}
        <span className="text-atlas-green">A{telemetry.pomeriumAllow}</span>
        <span className="text-atlas-dim">/</span>
        <span className="text-atlas-red">D{telemetry.pomeriumDeny}</span>
      </span>
      <span>
        Akash{" "}
        <span className="text-atlas-text">{telemetry.akashLeaseId}</span>
        <span className="text-atlas-dim"> · </span>
        <span className="text-atlas-dim">{telemetry.akashProvider}</span>
      </span>
      <span className="ml-auto text-atlas-dim">
        Stage <span className="text-atlas-cyan">{stage}</span>
      </span>
    </footer>
  );
}
