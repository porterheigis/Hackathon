/**
 * Nexla adapter — world model + position book as MCP-style tools.
 * Live path: NEXLA_SERVICE_KEY → https://api-genai.nexla.io/mcp/service_key/{key}
 * Demo path: local Nexset-backed tools mirroring schemas/mcp-tools.json
 */

import {
  appendPosition,
  getPositionBook,
  loadWorldModel,
  nowIso,
  uid,
} from "../store";
import type { PositionEntry, WorldEdge, WorldModel, WorldNode } from "../types";

export interface NexlaToolResult<T = unknown> {
  ok: boolean;
  tool: string;
  source: "nexla-live" | "nexla-local";
  data: T;
  latencyMs: number;
}

function hasLiveNexla(): boolean {
  return Boolean(process.env.NEXLA_SERVICE_KEY);
}

async function callLiveNexla(
  tool: string,
  args: Record<string, unknown>
): Promise<unknown | null> {
  const key = process.env.NEXLA_SERVICE_KEY;
  if (!key) return null;
  const base =
    process.env.NEXLA_MCP_URL ??
    `https://api-genai.nexla.io/mcp/service_key/${key}`;
  try {
    const res = await fetch(base, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: unknown };
    return json.result ?? null;
  } catch {
    return null;
  }
}

export async function getWorldModel(): Promise<NexlaToolResult<WorldModel>> {
  const t0 = Date.now();
  if (hasLiveNexla()) {
    const live = await callLiveNexla("get_world_model", {});
    if (live) {
      return {
        ok: true,
        tool: "get_world_model",
        source: "nexla-live",
        data: live as WorldModel,
        latencyMs: Date.now() - t0,
      };
    }
  }
  return {
    ok: true,
    tool: "get_world_model",
    source: "nexla-local",
    data: loadWorldModel(),
    latencyMs: Date.now() - t0,
  };
}

export interface MappedEvent {
  epicenter: WorldNode;
  affectedNodes: WorldNode[];
  affectedEdges: WorldEdge[];
  nodeIds: string[];
  edgeIds: string[];
}

export async function mapEventToNodes(args: {
  epicenter_node: string;
  implied_probability: number;
  max_hops?: number;
}): Promise<NexlaToolResult<MappedEvent>> {
  const t0 = Date.now();
  if (hasLiveNexla()) {
    const live = await callLiveNexla("map_event_to_nodes", args);
    if (live) {
      return {
        ok: true,
        tool: "map_event_to_nodes",
        source: "nexla-live",
        data: live as MappedEvent,
        latencyMs: Date.now() - t0,
      };
    }
  }

  const wm = loadWorldModel();
  const maxHops = args.max_hops ?? 4;
  const epicenter = wm.nodes.find((n) => n.id === args.epicenter_node);
  if (!epicenter) {
    throw new Error(`Unknown epicenter node: ${args.epicenter_node}`);
  }

  const adj = new Map<string, WorldEdge[]>();
  for (const e of wm.edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e);
    adj.set(e.from, list);
  }

  const visited = new Set<string>([epicenter.id]);
  const affectedEdges: WorldEdge[] = [];
  let frontier = [epicenter.id];

  for (let hop = 0; hop < maxHops; hop++) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const edge of adj.get(nodeId) ?? []) {
        affectedEdges.push(edge);
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          next.push(edge.to);
        }
      }
    }
    frontier = next;
  }

  const affectedNodes = wm.nodes.filter((n) => visited.has(n.id));

  return {
    ok: true,
    tool: "map_event_to_nodes",
    source: "nexla-local",
    data: {
      epicenter,
      affectedNodes,
      affectedEdges,
      nodeIds: [...visited],
      edgeIds: affectedEdges.map((e) => e.id),
    },
    latencyMs: Date.now() - t0,
  };
}

export async function getPositions(): Promise<
  NexlaToolResult<PositionEntry[]>
> {
  const t0 = Date.now();
  if (hasLiveNexla()) {
    const live = await callLiveNexla("get_positions", {});
    if (live) {
      return {
        ok: true,
        tool: "get_positions",
        source: "nexla-live",
        data: live as PositionEntry[],
        latencyMs: Date.now() - t0,
      };
    }
  }
  return {
    ok: true,
    tool: "get_positions",
    source: "nexla-local",
    data: getPositionBook(),
    latencyMs: Date.now() - t0,
  };
}

export async function logSignal(args: {
  market_id: string;
  side: string;
  ev: number;
  confidence: number;
  thesis?: string;
}): Promise<NexlaToolResult<PositionEntry>> {
  const t0 = Date.now();
  const entry: PositionEntry = {
    id: uid("sig"),
    ts: nowIso(),
    kind: "signal",
    market_id: args.market_id,
    side: args.side,
    ev: args.ev,
    confidence: args.confidence,
    thesis: args.thesis,
    status: "pending",
    audit: { nexla_tool: "log_signal" },
  };

  if (hasLiveNexla()) {
    const live = await callLiveNexla("log_signal", args);
    if (live) {
      return {
        ok: true,
        tool: "log_signal",
        source: "nexla-live",
        data: live as PositionEntry,
        latencyMs: Date.now() - t0,
      };
    }
  }

  appendPosition(entry);
  return {
    ok: true,
    tool: "log_signal",
    source: "nexla-local",
    data: entry,
    latencyMs: Date.now() - t0,
  };
}

export async function writeThesis(args: {
  thesis: string;
  market_id?: string;
}): Promise<NexlaToolResult<PositionEntry>> {
  const t0 = Date.now();
  const entry: PositionEntry = {
    id: uid("thesis"),
    ts: nowIso(),
    kind: "thesis",
    market_id: args.market_id,
    thesis: args.thesis,
    status: "pending",
    audit: { nexla_tool: "write_thesis" },
  };

  if (hasLiveNexla()) {
    const live = await callLiveNexla("write_thesis", args);
    if (live) {
      return {
        ok: true,
        tool: "write_thesis",
        source: "nexla-live",
        data: live as PositionEntry,
        latencyMs: Date.now() - t0,
      };
    }
  }

  appendPosition(entry);
  return {
    ok: true,
    tool: "write_thesis",
    source: "nexla-local",
    data: entry,
    latencyMs: Date.now() - t0,
  };
}

export async function recordFill(args: {
  market_id: string;
  side: string;
  size_usd: number;
  price: number;
  zero_tx?: string;
}): Promise<NexlaToolResult<PositionEntry>> {
  const t0 = Date.now();
  const entry: PositionEntry = {
    id: uid("fill"),
    ts: nowIso(),
    kind: "fill",
    market_id: args.market_id,
    side: args.side,
    size_usd: args.size_usd,
    price: args.price,
    status: "filled",
    pnl_usd: 0,
    audit: {
      nexla_tool: "record_fill",
      zero_tx: args.zero_tx ?? "",
    },
  };

  if (hasLiveNexla()) {
    const live = await callLiveNexla("record_fill", args);
    if (live) {
      return {
        ok: true,
        tool: "record_fill",
        source: "nexla-live",
        data: live as PositionEntry,
        latencyMs: Date.now() - t0,
      };
    }
  }

  appendPosition(entry);
  return {
    ok: true,
    tool: "record_fill",
    source: "nexla-local",
    data: entry,
    latencyMs: Date.now() - t0,
  };
}
