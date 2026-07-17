/** Shared types for ATLAS CAPITAL fund loop */

export type PipelineStage =
  | "IDLE"
  | "SCENARIO"
  | "SCREEN"
  | "AWAITING_OUTCOMES"
  | "MODEL"
  | "SIMULATE"
  | "PROPOSE"
  | "AWAITING_APPROVAL"
  | "RISK"
  | "EXECUTE"
  | "SETTLE"
  | "DONE"
  | "ERROR"
  // legacy stages kept for replay compatibility
  | "INGEST";

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
  aliases?: string[];
}

export interface WorldEdge {
  id: string;
  from: string;
  to: string;
  lane?: string;
  decay: number;
  commodity?: string;
  lane_type?: "sea" | "air";
  traffic?: number;
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
  kind: "signal" | "order" | "fill" | "pnl" | "denial" | "thesis" | "proposal";
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

export type TimelinePhaseId = "strike" | "cascade" | "adapt" | "impact";

export type AssetKind = "ship" | "tanker" | "plane" | "military";

export type AssetBehavior = "transit" | "queue" | "reroute" | "deploy";

export interface TimelineWaypoint {
  lat: number;
  lng: number;
  alt?: number;
}

export interface TimelineAsset {
  id: string;
  kind: AssetKind;
  edge_id?: string;
  waypoints: TimelineWaypoint[];
  spawn_t: number;
  speed: number;
  behavior: AssetBehavior;
  label?: string;
}

export interface TimelinePhase {
  id: TimelinePhaseId;
  start: number;
  end: number;
  caption: string;
  sim_day_start: number;
  sim_day_end: number;
}

export type TimelineEventKind =
  | "lane_freeze"
  | "ticker_pop"
  | "detection"
  | "tactical_cutaway"
  | "tactical_end"
  | "camera";

export interface TimelineEvent {
  t: number;
  kind: TimelineEventKind;
  payload?: Record<string, unknown>;
}

export interface SimTimeline {
  duration_ms: number;
  sim_days: number;
  phases: TimelinePhase[];
  assets: TimelineAsset[];
  events: TimelineEvent[];
  epicenter: string;
  severity: number;
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
  tickers?: PriceTicker[];
  detections?: DetectionRow[];
  vessel_count?: number;
  timeline?: SimTimeline;
}

export interface PriceTicker {
  node_id: string;
  label: string;
  delta_pct: number;
  lat: number;
  lng: number;
}

export interface DetectionRow {
  id: string;
  label: string;
  value: string;
  tone: "warn" | "crit" | "info";
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

export interface OutcomeVisual {
  effect: string;
  ticker: string;
  arc_behavior: "freeze_red" | "thin_dim" | string;
}

export interface OutcomeDef {
  id: string;
  name: string;
  direction_hint: "up" | "down" | "volatile";
  commodities: string[];
  lane_types: string[];
  markets: string[];
  visual: OutcomeVisual;
  detection_labels: string[];
}

export interface AffectedOutcome {
  id: string;
  name: string;
  direction: "up" | "down" | "volatile";
  confidence: number;
  reason: string;
  visual: OutcomeVisual;
  markets: string[];
}

export interface ScenarioPreset {
  id: string;
  label: string;
  text: string;
  epicenter_node: string;
  disruption_type: string;
  severity: number;
  implied_probability: number;
  default_outcomes: string[];
  markets: FixtureMarket[];
  news_headlines: string[];
}

export interface ScenarioMatch {
  scenario_id: string;
  preset_id?: string;
  text: string;
  epicenter_nodes: string[];
  disruption_type: string;
  severity: number;
  implied_probability: number;
  affected_outcomes: AffectedOutcome[];
  event: FixtureEvent;
}

export interface TradeProposal {
  id: string;
  market_id: string;
  question: string;
  side: string;
  ev: number;
  confidence: number;
  size_usd: number;
  price: number;
  rationale: string;
}

export interface FundState {
  stage: PipelineStage;
  clearance: "TRADER" | "DENIED";
  event: FixtureEvent | null;
  scenario: ScenarioMatch | null;
  affectedOutcomes: AffectedOutcome[];
  selectedOutcomes: string[];
  proposals: TradeProposal[];
  affectedNodes: string[];
  affectedEdges: string[];
  disruptedEdges: string[];
  sim: SimResult | null;
  positions: PositionEntry[];
  selectedMarket: MarketEV | null;
  attemptedSize: number | null;
  approvedSize: number | null;
  lastDenial: string | null;
  telemetry: Telemetry;
  tape: TapeEvent[];
  mode: "live" | "replay";
  viewport: "globe" | "tactical";
}

export interface OrchestratorEvent {
  type: "tape" | "state" | "stage" | "proposals" | "done" | "error";
  payload: unknown;
}

export interface SessionRecord {
  scenario: ScenarioMatch;
  selectedOutcomes: string[];
  state: FundState;
}
