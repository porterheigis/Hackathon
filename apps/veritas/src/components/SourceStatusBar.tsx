"use client";

import type { SourceStatus } from "@/lib/sse";

const SOURCES = ["polymarket", "news", "pomerium", "nexla", "anthropic"] as const;

function chipColor(status?: SourceStatus): string {
  switch (status?.status) {
    case "live":
      return "text-v-green border-v-green/40";
    case "mirror":
      return "text-v-warn border-v-warn/40";
    case "cached":
      return "text-v-warn border-v-warn/40";
    case "down":
      return "text-v-red border-v-red/50";
    default:
      return "text-v-dim border-v-hairline";
  }
}

function chipLabel(status?: SourceStatus): string {
  if (!status) return "—";
  if (status.status === "cached") {
    const hhmm = status.ts.slice(11, 16);
    return `CACHED ${hhmm}Z`;
  }
  return status.status.toUpperCase();
}

export function SourceStatusBar({
  statuses,
}: {
  statuses: Record<string, SourceStatus>;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-v-hairline bg-v-panel px-4 py-1.5 text-[10px] tracking-[0.15em]">
      <span className="text-v-dim uppercase">Sources</span>
      {SOURCES.map((source) => {
        const status = statuses[source];
        return (
          <span
            key={source}
            title={status?.detail ?? ""}
            className={`rounded-full border px-2 py-0.5 uppercase ${chipColor(status)}`}
          >
            {source} · {chipLabel(status)}
          </span>
        );
      })}
      <span className="ml-auto text-v-dim uppercase">
        no fixtures · failures shown, never masked
      </span>
    </div>
  );
}
