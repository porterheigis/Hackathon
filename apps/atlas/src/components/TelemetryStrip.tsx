"use client";

import type { FundState, PipelineStage } from "@/lib/types";

interface TelemetryStripProps {
  telemetry: FundState["telemetry"];
  stage: PipelineStage;
}

function modeLabel(source: string | undefined): string {
  if (!source || source === "—") return "";
  if (source.includes("live")) return "live";
  if (source.includes("fixture") || source.includes("local")) return "local";
  return source;
}

export function TelemetryStrip({ telemetry, stage }: TelemetryStripProps) {
  const s = telemetry.sources;

  return (
    <footer
      className="flex h-9 shrink-0 items-center gap-5 overflow-x-auto border-t border-atlas-hairline px-4 text-[11px] text-white/45 scrollbar-atlas"
      aria-label="Sponsor telemetry"
    >
      <span title={s?.zero ?? undefined}>
        Zero{" "}
        <span className="font-mono tabular text-white/70">
          ${telemetry.zeroSpendUsd.toFixed(2)}
        </span>
        {modeLabel(s?.zero) && (
          <span className="ml-1 text-atlas-amber/80">{modeLabel(s?.zero)}</span>
        )}
      </span>
      <span title={s?.nexla ?? undefined}>
        Nexla{" "}
        <span className="font-mono tabular text-white/70">
          {telemetry.nexlaToolCalls}
        </span>
        {modeLabel(s?.nexla) && (
          <span className="ml-1 text-atlas-amber/80">{modeLabel(s?.nexla)}</span>
        )}
      </span>
      <span title={s?.pomerium ?? undefined}>
        Pomerium{" "}
        <span className="text-atlas-green">A{telemetry.pomeriumAllow}</span>
        <span className="text-white/25">/</span>
        <span className="text-atlas-red">D{telemetry.pomeriumDeny}</span>
        {modeLabel(s?.pomerium) && (
          <span className="ml-1 text-atlas-amber/80">
            {modeLabel(s?.pomerium)}
          </span>
        )}
      </span>
      <span title={s?.akash ?? telemetry.akashEndpoint}>
        Akash{" "}
        <span className="font-mono text-white/70">{telemetry.akashLeaseId}</span>
        {modeLabel(s?.akash) && (
          <span className="ml-1 text-atlas-amber/80">{modeLabel(s?.akash)}</span>
        )}
      </span>
      <span className="ml-auto capitalize text-white/55">
        {stage.replace(/_/g, " ").toLowerCase()}
      </span>
    </footer>
  );
}
