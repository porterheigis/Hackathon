/**
 * SSE protocol shared between the agent loop (server) and the terminal UI (client).
 */
import type { PortfolioSnapshot } from "./portfolio";

export type TapeKind =
  | "thinking"
  | "say"
  | "tool_call"
  | "tool_result"
  | "deny"
  | "error"
  | "system";

export type SourceName =
  | "polymarket"
  | "news"
  | "pomerium"
  | "nexla"
  | "anthropic";

/**
 * live   — the real upstream answered just now
 * mirror — a local, honest stand-in is active (policy mirror, local journal) and labeled as such
 * cached — upstream failed; serving the last real response, timestamped
 * down   — upstream failed and no real response was ever obtained
 */
export type SourceState = "live" | "mirror" | "cached" | "down";

export interface SourceStatus {
  status: SourceState;
  ts: string;
  detail?: string;
}

export interface TapeLine {
  id: string;
  kind: TapeKind;
  text?: string;
  tool?: string;
  payload?: unknown;
}

export type AgentEvent =
  | {
      type: "tape";
      id: string;
      ts: string;
      kind: TapeKind;
      text?: string;
      tool?: string;
      payload?: unknown;
      delta?: boolean;
    }
  | { type: "state"; portfolio: PortfolioSnapshot }
  | {
      type: "source_status";
      source: SourceName;
      status: SourceState;
      ts: string;
      detail?: string;
    }
  | { type: "run_error"; message: string }
  | { type: "done" };

export type Emit = (event: AgentEvent) => void;

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function tapeLine(
  emit: Emit,
  kind: TapeKind,
  text: string,
  extra?: { tool?: string; payload?: unknown }
): void {
  emit({ type: "tape", id: uid("line"), ts: nowIso(), kind, text, ...extra });
}
