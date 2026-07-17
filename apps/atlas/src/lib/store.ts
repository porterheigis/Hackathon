import { readFileSync } from "fs";
import path from "path";
import type {
  FixtureEvent,
  PositionEntry,
  WorldModel,
} from "./types";

const ROOT = process.cwd();

export function loadWorldModel(): WorldModel {
  const p = path.join(ROOT, "data", "world-model.json");
  return JSON.parse(readFileSync(p, "utf-8")) as WorldModel;
}

export function loadFixtureEvent(): FixtureEvent {
  const p = path.join(ROOT, "data", "fixture-event.json");
  return JSON.parse(readFileSync(p, "utf-8")) as FixtureEvent;
}

/** In-memory position book (Nexset mirror for local adapter) */
let positionBook: PositionEntry[] = [];

export function getPositionBook(): PositionEntry[] {
  return [...positionBook];
}

export function appendPosition(entry: PositionEntry): PositionEntry {
  positionBook = [...positionBook, entry];
  return entry;
}

export function resetPositionBook(): void {
  positionBook = [];
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
