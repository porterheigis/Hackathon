import { readFileSync } from "fs";
import path from "path";
import type {
  FixtureEvent,
  FundState,
  PositionEntry,
  SessionRecord,
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

/** Survive Next.js HMR / route recompiles in dev */
type AtlasGlobal = typeof globalThis & {
  __atlasPositionBook?: PositionEntry[];
  __atlasSessions?: Map<string, SessionRecord>;
};

const g = globalThis as AtlasGlobal;

/** In-memory position book (Nexset mirror for local adapter) */
function positionBookRef(): PositionEntry[] {
  if (!g.__atlasPositionBook) g.__atlasPositionBook = [];
  return g.__atlasPositionBook;
}

export function getPositionBook(): PositionEntry[] {
  return [...positionBookRef()];
}

export function appendPosition(entry: PositionEntry): PositionEntry {
  g.__atlasPositionBook = [...positionBookRef(), entry];
  return entry;
}

export function resetPositionBook(): void {
  g.__atlasPositionBook = [];
}

/** Scenario session store for multi-phase API flow */
function sessions(): Map<string, SessionRecord> {
  if (!g.__atlasSessions) g.__atlasSessions = new Map();
  return g.__atlasSessions;
}

export function saveSession(id: string, record: SessionRecord): void {
  sessions().set(id, record);
}

export function getSession(id: string): SessionRecord | undefined {
  return sessions().get(id);
}

export function updateSession(
  id: string,
  patch: Partial<SessionRecord>
): SessionRecord | undefined {
  const cur = sessions().get(id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch };
  sessions().set(id, next);
  return next;
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

export function emptyFundState(mode: "live" | "replay" = "live"): FundState {
  return {
    stage: "IDLE",
    clearance: "TRADER",
    event: null,
    scenario: null,
    affectedOutcomes: [],
    selectedOutcomes: [],
    proposals: [],
    affectedNodes: [],
    affectedEdges: [],
    disruptedEdges: [],
    sim: null,
    positions: [],
    selectedMarket: null,
    attemptedSize: null,
    approvedSize: null,
    lastDenial: null,
    telemetry: {
      zeroSpendUsd: 0,
      zeroWalletUsd: 5,
      nexlaToolCalls: 0,
      pomeriumAllow: 0,
      pomeriumDeny: 0,
      akashLeaseId: "—",
      akashProvider: "—",
      akashEndpoint: "—",
      capabilitiesDiscovered: [],
      sources: {
        zero: "—",
        nexla: "—",
        pomerium: "—",
        akash: "—",
      },
    },
    tape: [],
    mode,
    viewport: "globe",
  };
}
