"use client";

import { useEffect, useState } from "react";
import type {
  LiveTransportSnapshot,
  ProviderStatus,
  TransportDataMode,
} from "@/lib/types";
import type { TransportLayerToggles } from "./GlobeView";

type BadgeKind = "LIVE" | "REPLAY" | "PARTIAL" | "UNAVAILABLE";

interface ObservedTrafficPanelProps {
  snapshot: LiveTransportSnapshot | null;
  regionLabel: string;
  layers: TransportLayerToggles;
  onToggle: (key: keyof TransportLayerToggles, value: boolean) => void;
  loading?: boolean;
}

/** Overall badge — LIVE only when BOTH providers are truly live; PARTIAL when mixed. */
function deriveBadge(m: TransportDataMode, a: TransportDataMode): BadgeKind {
  const live = [m, a].filter((x) => x === "live").length;
  const replay = [m, a].filter((x) => x === "replay").length;
  if (live === 2) return "LIVE";
  if (live === 1) return "PARTIAL";
  if (replay >= 1) return "REPLAY";
  return "UNAVAILABLE";
}

const BADGE_STYLE: Record<BadgeKind, string> = {
  LIVE: "border-atlas-green/60 text-atlas-green",
  PARTIAL: "border-atlas-amber/60 text-atlas-amber",
  REPLAY: "border-atlas-cyan/40 text-[#5a7d9a]",
  UNAVAILABLE: "border-atlas-red/50 text-atlas-red",
};

function modeText(mode: TransportDataMode): string {
  if (mode === "live") return "LIVE";
  if (mode === "replay") return "REPLAY";
  return "UNAVAILABLE";
}

function modeTone(mode: TransportDataMode): string {
  if (mode === "live") return "text-atlas-green";
  if (mode === "replay") return "text-[#5a7d9a]";
  return "text-atlas-red";
}

function ageLabel(capturedAt: string, now: number): string {
  const t = Date.parse(capturedAt);
  if (Number.isNaN(t)) return "—";
  const secs = Math.max(0, Math.round((now - t) / 1000));
  if (secs < 90) return `${secs}s ago`;
  return `${Math.round(secs / 60)}m ago`;
}

/** Human name for a provider, biased to the known free sources. */
function providerName(p: ProviderStatus, kind: "maritime" | "aviation"): string {
  if (p.provider && p.provider.toLowerCase() !== "replay") return p.provider;
  return kind === "maritime" ? "AISStream" : "ADSB.lol";
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-0.5 font-mono text-[10px] text-atlas-text">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3 w-3 shrink-0 accent-[#39d3f5]"
      />
      <span className="tracking-[0.05em]">{label}</span>
    </label>
  );
}

export function ObservedTrafficPanel({
  snapshot,
  regionLabel,
  layers,
  onToggle,
  loading,
}: ObservedTrafficPanelProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const maritime = snapshot?.providers.maritime;
  const aviation = snapshot?.providers.aviation;
  const badge: BadgeKind =
    maritime && aviation
      ? deriveBadge(maritime.mode, aviation.mode)
      : "UNAVAILABLE";

  const vesselCount = snapshot?.vessels.length ?? 0;
  const aircraftCount = snapshot?.aircraft.length ?? 0;

  // Attribution: only providers that are actually contributing data.
  const sources: string[] = [];
  let odbl = false;
  if (maritime && maritime.mode !== "unavailable") {
    sources.push(providerName(maritime, "maritime"));
  }
  if (aviation && aviation.mode !== "unavailable") {
    sources.push(providerName(aviation, "aviation"));
    odbl = true; // ADSB.lol data is ODbL 1.0
  }

  return (
    <div className="w-60 rounded-sm border border-atlas-hairline bg-atlas-bg/85 backdrop-blur-[3px]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-atlas-hairline px-3 py-2">
        <span className="font-mono text-[9px] tracking-[0.15em] text-atlas-muted uppercase">
          Live observed data
        </span>
        <span
          className={`rounded-sm border px-1.5 py-0.5 font-mono text-[8px] font-semibold tracking-[0.12em] uppercase ${BADGE_STYLE[badge]}`}
        >
          {badge}
        </span>
      </div>

      {/* Summary */}
      <div className="flex flex-col gap-1 px-3 py-2 font-mono text-[10px]">
        <div className="flex items-center justify-between">
          <span className="text-atlas-dim uppercase tracking-[0.08em] text-[9px]">
            Updated
          </span>
          <span className="text-atlas-text">
            {loading && !snapshot
              ? "loading…"
              : snapshot
                ? ageLabel(snapshot.capturedAt, now)
                : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-atlas-dim uppercase tracking-[0.08em] text-[9px]">
            Vessels
          </span>
          <span className="text-atlas-text tabular">{vesselCount}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-atlas-dim uppercase tracking-[0.08em] text-[9px]">
            Aircraft
          </span>
          <span className="text-atlas-text tabular">{aircraftCount}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-atlas-dim uppercase tracking-[0.08em] text-[9px]">
            Region
          </span>
          <span className="max-w-[9rem] truncate text-right text-atlas-text" title={regionLabel}>
            {regionLabel}
          </span>
        </div>
      </div>

      {/* Layer controls */}
      <div className="border-t border-atlas-hairline px-3 py-2">
        <span className="mb-1 block font-mono text-[8px] tracking-[0.12em] text-atlas-dim uppercase">
          Layers
        </span>
        <Checkbox
          label="Vessels"
          checked={layers.vessels}
          onChange={(v) => onToggle("vessels", v)}
        />
        <Checkbox
          label="Aircraft"
          checked={layers.aircraft}
          onChange={(v) => onToggle("aircraft", v)}
        />
        <Checkbox
          label="Supply-chain routes"
          checked={layers.routes}
          onChange={(v) => onToggle("routes", v)}
        />
        <Checkbox
          label="Labels"
          checked={layers.labels}
          onChange={(v) => onToggle("labels", v)}
        />
      </div>

      {/* Per-provider status */}
      <div className="border-t border-atlas-hairline px-3 py-2 font-mono text-[9px]">
        <div className="flex items-center gap-1">
          <span className="text-atlas-dim uppercase tracking-[0.08em]">Maritime:</span>
          <span className={maritime ? modeTone(maritime.mode) : "text-atlas-dim"}>
            {maritime ? modeText(maritime.mode) : "—"}
          </span>
          <span className="ml-auto text-atlas-dim">·</span>
          <span className="text-atlas-dim uppercase tracking-[0.08em]">Aviation:</span>
          <span className={aviation ? modeTone(aviation.mode) : "text-atlas-dim"}>
            {aviation ? modeText(aviation.mode) : "—"}
          </span>
        </div>
      </div>

      {/* Attribution — only active sources */}
      {sources.length > 0 && (
        <div className="border-t border-atlas-hairline px-3 py-1.5 font-mono text-[8px] leading-relaxed text-atlas-dim">
          Transport data: {sources.join(" · ")}
          {odbl ? " — ODbL" : ""}
        </div>
      )}
    </div>
  );
}
