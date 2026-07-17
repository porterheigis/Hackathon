"use client";

import type { FundState, PipelineStage } from "@/lib/types";

interface TelemetryStripProps {
  telemetry: FundState["telemetry"];
  stage: PipelineStage;
}

export function TelemetryStrip({ telemetry, stage }: TelemetryStripProps) {
  const akashLocal =
    telemetry.akashLeaseId === "—" ||
    telemetry.akashLeaseId.startsWith("local") ||
    telemetry.akashProvider.toLowerCase().includes("local");

  return (
    <footer
      className="flex h-9 shrink-0 items-center gap-6 overflow-x-auto border-t border-atlas-hairline px-4 text-[11px] text-white/45 scrollbar-atlas"
      aria-label="Sponsor telemetry"
    >
      <span>
        Zero{" "}
        <span className="font-mono tabular text-white/70">
          ${telemetry.zeroSpendUsd.toFixed(2)}
        </span>
      </span>
      <span>
        Nexla{" "}
        <span className="font-mono tabular text-white/70">
          {telemetry.nexlaToolCalls}
        </span>
      </span>
      <span>
        Pomerium{" "}
        <span className="text-atlas-green">A{telemetry.pomeriumAllow}</span>
        <span className="text-white/25">/</span>
        <span className="text-atlas-red">D{telemetry.pomeriumDeny}</span>
      </span>
      <span>
        Akash{" "}
        <span className="font-mono text-white/70">{telemetry.akashLeaseId}</span>
        {akashLocal && (
          <span className="ml-1 text-atlas-amber/80">local</span>
        )}
      </span>
      <span className="ml-auto capitalize text-white/55">
        {stage.replace(/_/g, " ").toLowerCase()}
      </span>
    </footer>
  );
}
