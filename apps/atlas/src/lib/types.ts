/** Shared types for ATLAS CAPITAL fund loop */

export type PipelineStage =
  | "IDLE"
  | "INGEST"
  | "MODEL"
  | "SIMULATE"
  | "RISK"
  | "EXECUTE"
  | "SETTLE"
  | "DONE"
  | "ERROR";

export type TapeKind = "plan" | "act" | "observe" | "correct" | "system";

export interface TapeEvent {
  id: string;
  ts: string;
  kind: TapeKind;
  stage: PipelineStage;
  message: string;
  meta?: Record<string, unknown>;
}

export interface WorldNode {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  region?: string;
  commodities?: string[];
}

export interface WorldEdge {
  id: string;
  from: string;
  to: string;
  lane?: string;
  decay: number;
  commodity?: string;
}

export interface WorldMarket {
  id: string;
  question: string;
  nodes: string[];
  side?: string;
}

export interface WorldModel {
  version: string;
  name: string;
  description?: string;
  nodes: WorldNode[];
  edges: WorldEdge[];
  markets: WorldMarket[];
}

export interface FixtureMarket {
  id: string;
  question: string;
  yes_price: number;
  no_price: number;
  volume_24h: number;
  zero_service: string;
}

export interface FixtureEvent {
  id: string;
  ts: string;
  title: string;
  summary: string;
  source: string;
  epicenter_node: string;
  lat: number;
  lng: number;
  implied_probability: number;
  markets: FixtureMarket[];
  news_headlines: string[];
}

export interface PositionEntry {
  id: string;
  ts: string;
  kind: "signal" | "order" | "fill" | "pnl" | "denial" | "thesis";
  market_id?: string;
  side?: string;
  size_usd?: number;
  price?: number;
  ev?: number;
  confidence?: number;
  status?: string;
  pnl_usd?: number;
  thesis?: string;
  audit?: Record<string, string>;
}

export interface MarketEV {
  market_id: string;
  question: string;
  side: string;
  mean_impact: number;
  p5: number;
  p95: number;
  expected_value: number;
  confidence: number;
  market_price?: number;
  edge?: number;
}

export interface SimResult {
  run_id: string;
  lease_id: string;
  provider: string;
  worker: string;
  n_sims: number;
  elapsed_ms: number;
  epicenter: string;
  node_exposure: Record<string, number>;
  propagation_order: string[];
  markets: MarketEV[];
}

export interface Telemetry {
  zeroSpendUsd: number;
  zeroWalletUsd: number;
  nexlaToolCalls: number;
  pomeriumAllow: number;
  pomeriumDeny: number;
  akashLeaseId: string;
  akashProvider: string;
  akashEndpoint: string;
  capabilitiesDiscovered: string[];
}

export interface FundState {
  stage: PipelineStage;
  clearance: "TRADER" | "DENIED";
  event: FixtureEvent | null;
  affectedNodes: string[];
  affectedEdges: string[];
  sim: SimResult | null;
  positions: PositionEntry[];
  selectedMarket: MarketEV | null;
  attemptedSize: number | null;
  approvedSize: number | null;
  lastDenial: string | null;
  telemetry: Telemetry;
  tape: TapeEvent[];
  mode: "live" | "replay";
}

export interface OrchestratorEvent {
  type: "tape" | "state" | "stage" | "done" | "error";
  payload: unknown;
}
