/** Shared formatting + color helpers for ChainAlpha panels. */

import type { EdgeStatus, NodeStatus } from "@/lib/types";

/** Compact USD, e.g. $4.2M, $1.1B, $850K, -$320K */
export function fmtUsdCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** Signed compact USD (always shows + / -) */
export function fmtUsdSigned(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const s = fmtUsdCompact(Math.abs(n));
  return n < 0 ? `-${s.replace("-", "")}` : `+${s}`;
}

export function fmtPct(
  n: number | null | undefined,
  digits = 0,
  signed = false
): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const v = n.toFixed(digits);
  const sign = signed && n > 0 ? "+" : "";
  return `${sign}${v}%`;
}

/** A range like "$1.2B – $2.1B" using a formatter */
export function fmtRange(
  min: number | null | undefined,
  max: number | null | undefined,
  fmt: (n: number | null | undefined) => string
): string {
  if (min === null || min === undefined) return "—";
  return `${fmt(min)} – ${fmt(max)}`;
}

export function fmtDays(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${Math.round(n)}d`;
}

// ─── Semantic colors (Tailwind classes) ─────────────────────

export function severityColor(
  sev: "none" | "low" | "medium" | "high" | "critical"
): string {
  switch (sev) {
    case "critical":
    case "high":
      return "text-atlas-red";
    case "medium":
      return "text-atlas-amber";
    case "low":
      return "text-atlas-cyan";
    default:
      return "text-atlas-dim";
  }
}

export function directionGlyph(
  dir: "negative" | "positive" | "mixed" | "neutral"
): { glyph: string; color: string } {
  switch (dir) {
    case "negative":
      return { glyph: "▼", color: "text-atlas-red" };
    case "positive":
      return { glyph: "▲", color: "text-atlas-green" };
    case "mixed":
      return { glyph: "◆", color: "text-atlas-amber" };
    default:
      return { glyph: "●", color: "text-atlas-dim" };
  }
}

// ─── Globe status → hex ─────────────────────────────────────

export const NODE_HEX: Record<NodeStatus, string> = {
  normal: "#3d4a5c",
  tension: "#ffb454",
  disrupted: "#ff5c5c",
  alternative: "#2fd682",
  recovered: "#2fd682",
};

export const EDGE_HEX: Record<EdgeStatus, string> = {
  normal: "#1c2430",
  constrained: "#ffb454",
  disrupted: "#ff5c5c",
  alternative: "#2fd682",
};
