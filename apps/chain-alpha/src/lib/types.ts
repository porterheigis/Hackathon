/** Shared types for ChainAlpha — supply-chain world model + trading simulation */

import type {
  LiveTransportSnapshot,
  TransportImpact,
} from "./live-transport/types";

export type {
  LiveTransportAsset,
  LiveTransportSnapshot,
  ProviderStatus,
  TransportImpact,
  TransportAssetType,
  TransportDataMode,
  TransportSource,
} from "./live-transport/types";

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
  /** ChainAlpha: named agent that produced this activity (Agents tab) */
  agent?: string;
  meta?: Record<string, unknown>;
}

// ─── World model ───────────────────────────────────────────

export type NodeStatus =
  | "normal"
  | "tension"
  | "disrupted"
  | "alternative"
  | "recovered";

export type EdgeStatus = "normal" | "constrained" | "disrupted" | "alternative";

export interface WorldNode {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  region?: string;
  commodities?: string[];
  // ChainAlpha optional extensions
  company?: string;
  facilityType?: string;
  products?: string[];
  capacity?: number;
  inventoryDays?: number;
  status?: NodeStatus;
}

export interface WorldEdge {
  id: string;
  from: string;
  to: string;
  lane?: string;
  decay: number;
  commodity?: string;
  // ChainAlpha optional extensions
  mode?: "sea" | "air" | "land" | "dependency";
  product?: string;
  capacity?: number;
  leadTimeDays?: number;
  substitutability?: number;
  status?: EdgeStatus;
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

// ─── Industry (ChainAlpha semiconductor track) ─────────────

export interface CompanyProfile {
  companyId: string;
  companyName: string;
  /** Base scenario direction before shock scaling */
  baseDirection: "negative" | "positive" | "mixed";
  baseSeverity: "low" | "medium" | "high" | "critical";
  /** How strongly this company is exposed to a manufacturing shock (0..1) */
  exposureWeight: number;
  /** Annual revenue scale (USD) used to bound revenue-at-risk estimates */
  revenueScaleUsd: number;
  reason: string;
  /** Node ids this company is anchored to on the graph */
  nodes?: string[];
}

export interface PortfolioSeed {
  id: string;
  name: string;
  exposureUsd: number;
  portfolioPercent: number;
  /** default beta to a semiconductor-supply shock: negative = hurt, positive = benefits */
  shockBeta: number;
}

export interface IndustryModel {
  id: string;
  name: string;
  worldModel: WorldModel;
  portfolio: PortfolioSeed[];
  companies: CompanyProfile[];
}

// ─── Scenarios ─────────────────────────────────────────────

export interface ScenarioShock {
  targetType: "node" | "edge" | "industry" | "product";
  targetId: string;
  metric: string;
  changePercent: number;
}

export interface ScenarioDefinition {
  id: string;
  industry: string;
  /** Which world graph this scenario renders/propagates over */
  worldModelId: string;
  targetCompany: string;
  title: string;
  prompt: string;
  eventType: string;
  epicenterNode: string;
  durationDays: number;
  horizonDays: number;
  shocks: ScenarioShock[];
  secondaryShockId?: string;
  source: "curated" | "parsed" | "live";
  /** Nodes that provide alternative capacity (green on the globe) */
  alternativeNodes?: string[];
  /** Nodes that structurally benefit from the disruption */
  beneficiaryNodes?: string[];
}

// ─── Impact model ──────────────────────────────────────────

export interface OperationalImpact {
  supplyReductionPercent: number;
  deliveryDelayDays: number;
  inventoryCoverageDays: number;
  shortageProbability: number;
  recoveryMinDays: number;
  recoveryMaxDays: number;
}

export interface CompanyImpact {
  companyId: string;
  companyName: string;
  direction: "negative" | "positive" | "mixed";
  severity: "low" | "medium" | "high" | "critical";
  revenueImpactMinUsd: number;
  revenueImpactMaxUsd: number;
  recoveryMinDays: number;
  recoveryMaxDays: number;
  reason: string;
}

export interface ImpactAssumption {
  id: string;
  label: string;
  value: string;
  sensitivity: "low" | "medium" | "high";
}

export interface FinancialImpact {
  revenueAtRiskMinUsd: number;
  revenueAtRiskMaxUsd: number;
  grossMarginImpactMinPoints: number;
  grossMarginImpactMaxPoints: number;
  estimatedMarketMoveMinPercent: number;
  estimatedMarketMoveMaxPercent: number;
  confidence: number;
  assumptions: ImpactAssumption[];
}

// ─── Trade strategy ────────────────────────────────────────

export interface TradeAction {
  asset: string;
  action: "increase" | "reduce" | "hedge";
  positionChangePercent: number;
  thesis: string;
}

export interface TradeProposal {
  revision: number;
  actions: TradeAction[];
  expectedPnlUsd: number;
  maxDrawdownPercent: number;
  confidence: number;
  status: "proposed" | "blocked" | "approved" | "executed";
  /** Notional routed through Pomerium (mirrors the stake-limit gate) */
  notionalUsd?: number;
  /** Policy limit that was violated (populated on a blocked proposal) */
  violatedLimit?: string;
}

// ─── Portfolio + telemetry ─────────────────────────────────

export interface PortfolioPosition {
  id: string;
  name: string;
  exposureUsd: number;
  portfolioPercent: number;
  direction: "negative" | "positive" | "mixed" | "neutral";
  severity: "none" | "low" | "medium" | "high" | "critical";
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

// ─── Scenario simulation result (Akash) ────────────────────

export interface PropagationEvent {
  nodeId: string;
  status: NodeStatus;
  hop: number;
  note?: string;
}

export interface ScenarioSimResult {
  runId: string;
  leaseId: string;
  provider: string;
  endpoint: string;
  worker: string;
  nSims: number;
  elapsedMs: number;
  epicenter: string;
  worldModelId: string;
  nodeStatuses: Record<string, NodeStatus>;
  edgeStatuses: Record<string, EdgeStatus>;
  propagationOrder: string[];
  propagationEvents: PropagationEvent[];
  operational: OperationalImpact;
  companies: CompanyImpact[];
  financial: FinancialImpact;
  confidence: number;
  source: "akash-live" | "akash-local";
}

// ─── Fund state (streamed to the UI) ───────────────────────

export interface FundState {
  stage: PipelineStage;
  mode: "live" | "replay";
  clearance: "TRADER" | "DENIED";

  scenario: ScenarioDefinition | null;
  parseConfidence: number;
  parseSource: "curated" | "parsed" | "fallback";
  secondaryShockApplied: boolean;

  worldModelId: string;
  affectedNodes: string[];
  affectedEdges: string[];
  nodeStatuses: Record<string, NodeStatus>;
  edgeStatuses: Record<string, EdgeStatus>;
  propagationOrder: string[];
  propagationEvents: PropagationEvent[];

  operational: OperationalImpact | null;
  companies: CompanyImpact[];
  financial: FinancialImpact | null;
  sim: ScenarioSimResult | null;

  portfolio: PortfolioPosition[];
  proposals: TradeProposal[];
  positions: PositionEntry[];

  attemptedSize: number | null;
  approvedSize: number | null;
  lastDenial: string | null;

  businessPhase: number;
  pnlUsd: number;

  // ─── Live-transport layer (observed vessels/aircraft) ───
  /** Immutable snapshot captured when the run started (null until captured). */
  transportBaseline: LiveTransportSnapshot | null;
  /** Ids of observed assets intersecting the simulated disruption. */
  exposedTransportAssets: string[];
  /** Explainable transport-exposure estimate (null until computed). */
  transportImpact: TransportImpact | null;

  telemetry: Telemetry;
  tape: TapeEvent[];
}

export interface OrchestratorEvent {
  type: "tape" | "state" | "stage" | "done" | "error";
  payload: unknown;
}

// ─── Legacy Red Sea / prediction-market types (adapters + tests) ───

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
