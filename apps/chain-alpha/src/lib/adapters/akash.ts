/**
 * Akash Monte Carlo adapter.
 * Calls AKASH_SIM_URL when set; otherwise runs embedded TS Monte Carlo
 * (mirrors akash/worker/main.py) and still emits lease telemetry.
 */

import { computeScenarioImpact, mergeScenario } from "../impact";
import { seedPortfolio } from "../scenarios";
import { loadWorldModel, uid } from "../store";
import type {
  EdgeStatus,
  FixtureEvent,
  IndustryModel,
  MarketEV,
  NodeStatus,
  PropagationEvent,
  ScenarioDefinition,
  ScenarioSimResult,
  SimResult,
  WorldEdge,
  WorldModel,
} from "../types";

export interface AkashLeaseInfo {
  lease_id: string;
  provider: string;
  endpoint: string;
  source: "akash-live" | "akash-local";
}

function leaseInfo(): AkashLeaseInfo {
  const url = process.env.AKASH_SIM_URL;
  if (url) {
    return {
      lease_id: process.env.AKASH_LEASE_ID ?? "akash-lease-live",
      provider: process.env.AKASH_PROVIDER ?? "akash-provider",
      endpoint: url,
      source: "akash-live",
    };
  }
  return {
    lease_id: `local-${uid("lease").slice(-8)}`,
    provider: "local-embedded",
    endpoint: "http://127.0.0.1:8080 (embedded)",
    source: "akash-local",
  };
}

function buildAdj(edges: WorldEdge[]): Map<string, { to: string; decay: number }[]> {
  const adj = new Map<string, { to: string; decay: number }[]>();
  for (const e of edges) {
    const list = adj.get(e.from) ?? [];
    list.push({ to: e.to, decay: e.decay });
    adj.set(e.from, list);
  }
  return adj;
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function propagateOnce(
  rand: () => number,
  epicenter: string,
  pHit: number,
  adj: Map<string, { to: string; decay: number }[]>,
  maxHops = 5
): Record<string, number> {
  const exposure: Record<string, number> = {};
  if (rand() > pHit) return exposure;

  const frontier: { node: string; strength: number; hops: number }[] = [
    { node: epicenter, strength: 1, hops: 0 },
  ];
  const visited = new Set<string>();

  while (frontier.length) {
    const { node, strength, hops } = frontier.shift()!;
    if (visited.has(node) || hops > maxHops) continue;
    visited.add(node);
    exposure[node] = Math.max(exposure[node] ?? 0, strength);
    for (const edge of adj.get(node) ?? []) {
      if (visited.has(edge.to)) continue;
      const transmitP = edge.decay * strength;
      if (rand() < Math.min(1, transmitP + 0.15)) {
        frontier.push({
          node: edge.to,
          strength: strength * edge.decay,
          hops: hops + 1,
        });
      }
    }
  }
  return exposure;
}

function runEmbeddedSim(
  event: FixtureEvent,
  nSims = 2000
): SimResult {
  const t0 = Date.now();
  const wm = loadWorldModel();
  const adj = buildAdj(wm.edges);
  const rand = mulberry32(42);
  const nodeSums: Record<string, number> = {};

  for (let i = 0; i < nSims; i++) {
    const exp = propagateOnce(
      rand,
      event.epicenter_node,
      event.implied_probability,
      adj
    );
    for (const [k, v] of Object.entries(exp)) {
      nodeSums[k] = (nodeSums[k] ?? 0) + v;
    }
  }

  const node_exposure: Record<string, number> = {};
  for (const [k, v] of Object.entries(nodeSums)) {
    node_exposure[k] = Math.round((v / nSims) * 10000) / 10000;
  }

  const propagation_order = Object.keys(node_exposure).sort(
    (a, b) => node_exposure[b] - node_exposure[a]
  );

  const lease = leaseInfo();
  const markets: MarketEV[] = event.markets.map((m) => {
    const impacts: number[] = [];
    const mRand = mulberry32(hashStr(m.id));
    const wmMarket = wm.markets.find((x) => x.id === m.id);
    const nodes = wmMarket?.nodes ?? [];

    for (let i = 0; i < Math.min(nSims, 800); i++) {
      const exp = propagateOnce(
        mRand,
        event.epicenter_node,
        event.implied_probability,
        adj
      );
      const vals = nodes.map((n) => exp[n] ?? 0);
      impacts.push(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
    }

    const mean =
      impacts.reduce((a, b) => a + b, 0) / Math.max(1, impacts.length);
    const sorted = [...impacts].sort((a, b) => a - b);
    const p5 = sorted[Math.floor(sorted.length * 0.05)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const fair = Math.min(
      0.95,
      Math.max(0.05, event.implied_probability * (0.7 + 0.6 * mean))
    );
    const edge = fair - m.yes_price;
    const confidence = Math.min(0.95, 0.4 + Math.abs(edge) * 2 + mean * 0.3);

    return {
      market_id: m.id,
      question: m.question,
      side: "YES",
      mean_impact: Math.round(mean * 10000) / 10000,
      p5: Math.round(p5 * 10000) / 10000,
      p95: Math.round(p95 * 10000) / 10000,
      expected_value: Math.round(edge * 10000) / 10000,
      confidence: Math.round(confidence * 10000) / 10000,
      market_price: m.yes_price,
      edge: Math.round(edge * 10000) / 10000,
    };
  });

  markets.sort((a, b) => Math.abs(b.expected_value) - Math.abs(a.expected_value));

  return {
    run_id: `sim-${uid("run").slice(-10)}`,
    lease_id: lease.lease_id,
    provider: lease.provider,
    worker: "chainalpha-monte-carlo",
    n_sims: nSims,
    elapsed_ms: Date.now() - t0,
    epicenter: event.epicenter_node,
    node_exposure,
    propagation_order,
    markets,
  };
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

export async function runSimulation(
  event: FixtureEvent
): Promise<{ result: SimResult; lease: AkashLeaseInfo }> {
  const lease = leaseInfo();
  const url = process.env.AKASH_SIM_URL;

  if (url) {
    try {
      const wm = loadWorldModel();
      const res = await fetch(`${url.replace(/\/$/, "")}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          epicenter_node: event.epicenter_node,
          implied_probability: event.implied_probability,
          edges: wm.edges,
          markets: event.markets.map((m) => ({
            id: m.id,
            question: m.question,
            nodes: wm.markets.find((x) => x.id === m.id)?.nodes ?? [],
            side: "YES",
            yes_price: m.yes_price,
          })),
          n_sims: 3000,
          seed: 42,
        }),
      });
      if (res.ok) {
        const result = (await res.json()) as SimResult;
        return {
          result: { ...result, lease_id: lease.lease_id, provider: lease.provider },
          lease,
        };
      }
    } catch {
      // fall through to embedded
    }
  }

  return { result: runEmbeddedSim(event), lease };
}

export function getAkashLeaseInfo(): AkashLeaseInfo {
  return leaseInfo();
}

// ─── ChainAlpha supply-chain scenario simulation ───────────

const CHAINALPHA_WORKER = "chainalpha-supply-sim";

export interface NetworkStatuses {
  nodeStatuses: Record<string, NodeStatus>;
  edgeStatuses: Record<string, EdgeStatus>;
  disrupted: string[];
  tension: string[];
  alternative: string[];
}

/**
 * Deterministically map scenario shocks onto node + edge statuses.
 *  - disrupted: node-shock targets + epicenter
 *  - alternative: scenario.alternativeNodes still healthy (not disrupted)
 *  - tension: nodes reachable downstream (BFS over edges) from disrupted, still healthy
 *  - edges: shock targets → disrupted (|Δ|≥50) or constrained; edges from alt nodes → alternative
 */
export function deriveNetworkStatuses(
  scenario: ScenarioDefinition,
  world: WorldModel
): NetworkStatuses {
  const nodeStatuses: Record<string, NodeStatus> = {};
  const edgeStatuses: Record<string, EdgeStatus> = {};
  for (const n of world.nodes) nodeStatuses[n.id] = "normal";
  for (const e of world.edges) edgeStatuses[e.id] = "normal";

  const disrupted = new Set<string>();
  if (scenario.epicenterNode) disrupted.add(scenario.epicenterNode);
  for (const s of scenario.shocks) {
    if (s.targetType === "node") disrupted.add(s.targetId);
  }
  for (const id of disrupted) if (nodeStatuses[id] !== undefined) nodeStatuses[id] = "disrupted";

  // Alternative capacity that survives (not itself disrupted).
  const alternative = new Set<string>();
  for (const id of scenario.alternativeNodes ?? []) {
    if (!disrupted.has(id) && nodeStatuses[id] !== undefined) {
      nodeStatuses[id] = "alternative";
      alternative.add(id);
    }
  }

  // Downstream tension via BFS over edges from every disrupted node.
  const adj = new Map<string, string[]>();
  for (const e of world.edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
  }
  const tension = new Set<string>();
  const visited = new Set<string>([...disrupted]);
  let frontier = [...disrupted];
  for (let hop = 0; hop < 5 && frontier.length; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const to of adj.get(id) ?? []) {
        if (visited.has(to)) continue;
        visited.add(to);
        next.push(to);
        if (nodeStatuses[to] === "normal") {
          nodeStatuses[to] = "tension";
          tension.add(to);
        }
      }
    }
    frontier = next;
  }

  // Edge statuses from edge shocks.
  for (const s of scenario.shocks) {
    if (s.targetType !== "edge") continue;
    if (edgeStatuses[s.targetId] === undefined) continue;
    edgeStatuses[s.targetId] = Math.abs(s.changePercent) >= 50 ? "disrupted" : "constrained";
  }
  // Edges originating from alternative nodes carry the re-routed flow.
  for (const e of world.edges) {
    if (alternative.has(e.from) && edgeStatuses[e.id] === "normal") {
      edgeStatuses[e.id] = "alternative";
    }
  }

  return {
    nodeStatuses,
    edgeStatuses,
    disrupted: [...disrupted].filter((id) => nodeStatuses[id] !== undefined),
    tension: [...tension],
    alternative: [...alternative],
  };
}

function hashSeed(...parts: string[]): number {
  return hashStr(parts.join("|"));
}

/** Seeded Monte-Carlo exposure + hop map over the supply graph. */
function propagateScenario(
  world: WorldModel,
  epicenter: string,
  seed: number,
  nSims: number
): { exposure: Record<string, number>; hop: Record<string, number> } {
  const adj = new Map<string, { to: string; decay: number }[]>();
  for (const e of world.edges) {
    const list = adj.get(e.from) ?? [];
    list.push({ to: e.to, decay: e.decay });
    adj.set(e.from, list);
  }

  // Deterministic shortest-hop distances from the epicenter.
  const hop: Record<string, number> = { [epicenter]: 0 };
  let frontier = [epicenter];
  let d = 0;
  while (frontier.length) {
    d += 1;
    const next: string[] = [];
    for (const id of frontier) {
      for (const { to } of adj.get(id) ?? []) {
        if (hop[to] === undefined) {
          hop[to] = d;
          next.push(to);
        }
      }
    }
    frontier = next;
  }

  const rand = mulberry32(seed);
  const sums: Record<string, number> = {};
  for (let i = 0; i < nSims; i++) {
    const exp = propagateOnce(rand, epicenter, 0.95, adj);
    for (const [k, v] of Object.entries(exp)) sums[k] = (sums[k] ?? 0) + v;
  }
  const exposure: Record<string, number> = {};
  for (const [k, v] of Object.entries(sums)) {
    exposure[k] = Math.round((v / nSims) * 10000) / 10000;
  }
  return { exposure, hop };
}

export interface RunScenarioArgs {
  scenario: ScenarioDefinition;
  industry: IndustryModel;
  worldModel: WorldModel;
  secondary?: ScenarioDefinition;
}

/**
 * ChainAlpha SIMULATE. Merges any secondary shock, derives node/edge statuses, runs a
 * seeded Monte-Carlo propagation, and attaches the deterministic impact engine's
 * operational / company / financial output. Emits Akash lease telemetry (akash-local
 * fallback when AKASH_SIM_URL is unset).
 */
export function runScenarioSimulation(args: RunScenarioArgs): ScenarioSimResult {
  const t0 = Date.now();
  const merged = mergeScenario(args.scenario, args.secondary);
  const world = args.worldModel;
  const secondaryApplied = Boolean(args.secondary);

  const statuses = deriveNetworkStatuses(merged, world);

  const seed = hashSeed(merged.id, secondaryApplied ? "japan" : "primary", merged.epicenterNode);
  const nSims = 2000;
  const { exposure, hop } = propagateScenario(world, merged.epicenterNode, seed, nSims);

  const propagationOrder = Object.keys(exposure).sort(
    (a, b) => (exposure[b] ?? 0) - (exposure[a] ?? 0) || (hop[a] ?? 99) - (hop[b] ?? 99)
  );
  const propagationEvents: PropagationEvent[] = propagationOrder.map((nodeId) => ({
    nodeId,
    status: statuses.nodeStatuses[nodeId] ?? "normal",
    hop: hop[nodeId] ?? 0,
    note: `exposure ${(exposure[nodeId] ?? 0).toFixed(3)}`,
  }));

  const seedPf = seedPortfolio(args.industry);
  const impact = computeScenarioImpact(merged, args.industry, seedPf, secondaryApplied);

  const lease = leaseInfo();

  return {
    runId: `csim-${uid("run").slice(-10)}`,
    leaseId: lease.lease_id,
    provider: lease.provider,
    endpoint: lease.endpoint,
    worker: CHAINALPHA_WORKER,
    nSims,
    elapsedMs: Date.now() - t0,
    epicenter: merged.epicenterNode,
    worldModelId: merged.worldModelId,
    nodeStatuses: statuses.nodeStatuses,
    edgeStatuses: statuses.edgeStatuses,
    propagationOrder,
    propagationEvents,
    operational: impact.operational,
    companies: impact.companies,
    financial: impact.financial,
    confidence: impact.confidence,
    source: lease.source,
  };
}
