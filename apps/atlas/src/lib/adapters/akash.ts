/**
 * Akash Monte Carlo adapter — conditioned on outcome_filter + disruption.
 */

import { loadOutcomes } from "../scenario";
import { loadWorldModel, uid } from "../store";
import type {
  DetectionRow,
  FixtureEvent,
  MarketEV,
  PriceTicker,
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

export interface SimOptions {
  outcome_filter?: string[];
  disruption?: { nodes: string[]; type: string; severity: number };
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

function filterEdges(
  edges: WorldEdge[],
  outcomeFilter: string[] | undefined
): WorldEdge[] {
  if (!outcomeFilter?.length) return edges;
  const { outcomes } = loadOutcomes();
  const defs = outcomes.filter((o) => outcomeFilter.includes(o.id));
  const commodities = new Set(defs.flatMap((o) => o.commodities));
  const lanes = new Set(defs.flatMap((o) => o.lane_types));
  return edges.filter((e) => {
    const c = e.commodity ?? "";
    const lt = e.lane_type ?? "sea";
    return commodities.has(c) || lanes.has(lt);
  });
}

function buildAdj(
  edges: WorldEdge[],
  severity: number
): Map<string, { to: string; decay: number }[]> {
  const adj = new Map<string, { to: string; decay: number }[]>();
  for (const e of edges) {
    const list = adj.get(e.from) ?? [];
    // severity scales transmission probability
    list.push({ to: e.to, decay: Math.min(0.99, e.decay * (0.7 + 0.3 * severity)) });
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

function buildTickers(
  wm: WorldModel,
  exposure: Record<string, number>,
  outcomeFilter: string[] | undefined,
  severity: number
): PriceTicker[] {
  const { outcomes } = loadOutcomes();
  const defs = outcomes.filter(
    (o) => !outcomeFilter?.length || outcomeFilter.includes(o.id)
  );
  const tickers: PriceTicker[] = [];
  for (const o of defs) {
    const node =
      wm.nodes.find((n) =>
        n.commodities?.some((c) => o.commodities.includes(c))
      ) ?? wm.nodes.find((n) => n.type === "commodity");
    if (!node) continue;
    const exp = exposure[node.id] ?? severity * 0.5;
    const sign = o.direction_hint === "down" ? -1 : 1;
    const delta = Math.round(sign * (8 + exp * 40 + severity * 15) * 10) / 10;
    tickers.push({
      node_id: node.id,
      label: o.visual.ticker,
      delta_pct: delta,
      lat: node.lat,
      lng: node.lng,
    });
  }
  return tickers.slice(0, 5);
}

function buildDetections(
  outcomeFilter: string[] | undefined,
  severity: number,
  vesselCount: number
): DetectionRow[] {
  const { outcomes } = loadOutcomes();
  const defs = outcomes.filter(
    (o) => !outcomeFilter?.length || outcomeFilter.includes(o.id)
  );
  const rows: DetectionRow[] = [
    {
      id: "vessels",
      label: "TANKERS HOLDING",
      value: String(vesselCount),
      tone: "crit",
    },
    {
      id: "transits",
      label: "TRANSITS/HR",
      value: `−${Math.round(60 + severity * 30)}%`,
      tone: "warn",
    },
  ];
  for (const o of defs.slice(0, 3)) {
    const label = o.detection_labels[0] ?? o.name.toUpperCase();
    rows.push({
      id: o.id,
      label,
      value:
        o.direction_hint === "down"
          ? `−${Math.round(15 + severity * 25)}%`
          : `+${Math.round(10 + severity * 30)}%`,
      tone: o.direction_hint === "down" ? "warn" : "crit",
    });
  }
  return rows;
}

function runEmbeddedSim(
  event: FixtureEvent,
  opts: SimOptions = {},
  nSims = 2000
): SimResult {
  const t0 = Date.now();
  const wm = loadWorldModel();
  const severity = opts.disruption?.severity ?? 0.8;
  const edges = filterEdges(wm.edges, opts.outcome_filter);
  const adj = buildAdj(edges, severity);
  const rand = mulberry32(42);
  const pHit = Math.min(
    0.95,
    event.implied_probability * (0.85 + 0.2 * severity)
  );
  const nodeSums: Record<string, number> = {};

  for (let i = 0; i < nSims; i++) {
    const exp = propagateOnce(rand, event.epicenter_node, pHit, adj);
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
  const marketSource = event.markets.length
    ? event.markets
    : wm.markets.map((m) => ({
        id: m.id,
        question: m.question,
        yes_price: 0.45,
        no_price: 0.55,
        volume_24h: 100000,
        zero_service: "prediction-market-odds",
      }));

  const markets: MarketEV[] = marketSource.map((m) => {
    const impacts: number[] = [];
    const mRand = mulberry32(hashStr(m.id));
    const wmMarket = wm.markets.find((x) => x.id === m.id);
    const nodes = wmMarket?.nodes ?? [event.epicenter_node];

    for (let i = 0; i < Math.min(nSims, 800); i++) {
      const exp = propagateOnce(mRand, event.epicenter_node, pHit, adj);
      const vals = nodes.map((n) => exp[n] ?? 0);
      impacts.push(
        vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
      );
    }

    const mean =
      impacts.reduce((a, b) => a + b, 0) / Math.max(1, impacts.length);
    const sorted = [...impacts].sort((a, b) => a - b);
    const p5 = sorted[Math.floor(sorted.length * 0.05)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const fair = Math.min(
      0.95,
      Math.max(0.05, pHit * (0.7 + 0.6 * mean) * severity)
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

  markets.sort(
    (a, b) => Math.abs(b.expected_value) - Math.abs(a.expected_value)
  );

  const vessel_count = Math.round(8 + severity * 18);
  const tickers = buildTickers(
    wm,
    node_exposure,
    opts.outcome_filter,
    severity
  );
  const detections = buildDetections(
    opts.outcome_filter,
    severity,
    vessel_count
  );

  return {
    run_id: `sim-${uid("run").slice(-10)}`,
    lease_id: lease.lease_id,
    provider: lease.provider,
    worker: "atlas-monte-carlo",
    n_sims: nSims,
    elapsed_ms: Date.now() - t0,
    epicenter: event.epicenter_node,
    node_exposure,
    propagation_order,
    markets,
    tickers,
    detections,
    vessel_count,
  };
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

export async function runSimulation(
  event: FixtureEvent,
  opts: SimOptions = {}
): Promise<{ result: SimResult; lease: AkashLeaseInfo }> {
  const lease = leaseInfo();
  const url = process.env.AKASH_SIM_URL;

  if (url) {
    try {
      const wm = loadWorldModel();
      const edges = filterEdges(wm.edges, opts.outcome_filter);
      const res = await fetch(`${url.replace(/\/$/, "")}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          epicenter_node: event.epicenter_node,
          implied_probability: event.implied_probability,
          edges,
          markets: event.markets.map((m) => ({
            id: m.id,
            question: m.question,
            nodes: wm.markets.find((x) => x.id === m.id)?.nodes ?? [],
            side: "YES",
            yes_price: m.yes_price,
          })),
          outcome_filter: opts.outcome_filter ?? [],
          disruption: opts.disruption,
          n_sims: 3000,
          seed: 42,
        }),
      });
      if (res.ok) {
        const result = (await res.json()) as SimResult;
        return {
          result: {
            ...result,
            lease_id: lease.lease_id,
            provider: lease.provider,
          },
          lease,
        };
      }
    } catch {
      // fall through
    }
  }

  return { result: runEmbeddedSim(event, opts), lease };
}

export function getAkashLeaseInfo(): AkashLeaseInfo {
  return leaseInfo();
}
