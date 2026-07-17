"use client";

import { useMemo } from "react";
import type {
  IntegrationSources,
  PipelineStage,
  TapeEvent,
} from "@/lib/types";

interface SponsorRailProps {
  tape: TapeEvent[];
  sources: IntegrationSources;
  currentStage: PipelineStage;
  running: boolean;
}

interface SponsorDef {
  name: "Zero" | "Nexla" | "Akash" | "Pomerium";
  role: string;
  stages: PipelineStage[];
  sourceKey: keyof IntegrationSources;
}

const SPONSORS: SponsorDef[] = [
  {
    name: "Zero",
    role: "Odds · News · Fills",
    stages: ["SCENARIO", "EXECUTE"],
    sourceKey: "zero",
  },
  {
    name: "Nexla",
    role: "World model · Book",
    stages: ["SCREEN", "MODEL", "PROPOSE", "SETTLE"],
    sourceKey: "nexla",
  },
  {
    name: "Akash",
    role: "Monte Carlo sim",
    stages: ["SIMULATE"],
    sourceKey: "akash",
  },
  {
    name: "Pomerium",
    role: "Risk gate",
    stages: ["RISK"],
    sourceKey: "pomerium",
  },
];

function formatClock(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function SponsorRail({
  tape,
  sources,
  currentStage,
  running,
}: SponsorRailProps) {
  const entries = useMemo(
    () =>
      SPONSORS.map((s) => {
        const first = tape.find((e) => e.meta?.actor === s.name);
        const source = sources?.[s.sourceKey];
        const mode =
          !source || source === "—"
            ? null
            : source.includes("live")
              ? ("live" as const)
              : ("local" as const);
        return {
          ...s,
          used: Boolean(first),
          firstUsedAt: first ? formatClock(first.ts) : null,
          active: running && s.stages.includes(currentStage),
          mode,
        };
      }),
    [tape, sources, currentStage, running]
  );

  return (
    <div
      className="flex h-8 shrink-0 items-center gap-6 overflow-x-auto border-b border-atlas-hairline bg-atlas-bg px-4 scrollbar-atlas"
      aria-label="Sponsor platform usage"
    >
      <span className="eyebrow shrink-0">Powered by</span>
      {entries.map((s) => (
        <div key={s.name} className="flex shrink-0 items-center gap-2">
          {s.active ? (
            <span className="sponsor-pulse h-1.5 w-1.5 rounded-full bg-atlas-cyan" />
          ) : s.used ? (
            <span className="font-mono text-[10px] leading-none text-atlas-green">
              ✓
            </span>
          ) : (
            <span className="h-1.5 w-1.5 rounded-full border border-white/25" />
          )}
          <span
            className={`font-mono text-[11px] uppercase tracking-wide transition-colors duration-200 ${
              s.active
                ? "text-atlas-cyan"
                : s.used
                  ? "text-white/80"
                  : "text-white/35"
            }`}
          >
            {s.name}
          </span>
          <span className="text-[10px] text-white/35">{s.role}</span>
          {s.mode && (
            <span
              className={`rounded-sm border px-1 py-px font-mono text-[9px] uppercase leading-none ${
                s.mode === "live"
                  ? "border-atlas-green/40 text-atlas-green"
                  : "border-atlas-amber/40 text-atlas-amber"
              }`}
            >
              {s.mode}
            </span>
          )}
          {s.used && s.firstUsedAt && (
            <span className="font-mono text-[9px] tabular text-white/30">
              {s.firstUsedAt}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
