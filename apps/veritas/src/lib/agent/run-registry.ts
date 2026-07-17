/**
 * Single active run registry. The SSE route begins a run; the /api/tools/*
 * routes look it up to emit tool activity onto the live tape. One run at a
 * time — the concurrency guard lives here.
 */
import type { Emit } from "../sse";
import { uid } from "../sse";
import type { RunState } from "./tools";

export interface ActiveRun {
  id: string;
  emit: Emit;
  state: RunState;
  startedAt: number;
}

let current: ActiveRun | null = null;

export function beginRun(emit: Emit): ActiveRun | null {
  if (current) return null;
  current = { id: uid("run"), emit, state: { trades: 0, denials: 0 }, startedAt: Date.now() };
  return current;
}

export function endRun(id: string): void {
  if (current?.id === id) current = null;
}

export function getActiveRun(): ActiveRun | null {
  return current;
}
