/**
 * Deterministic scenario matcher — maps free text / presets to epicenter + outcomes.
 */

import { readFileSync } from "fs";
import path from "path";
import { loadWorldModel, uid } from "./store";
import type {
  AffectedOutcome,
  FixtureEvent,
  FixtureMarket,
  OutcomeDef,
  ScenarioMatch,
  ScenarioPreset,
  WorldModel,
} from "./types";

const ROOT = process.cwd();

export function loadScenarios(): { presets: ScenarioPreset[] } {
  const p = path.join(ROOT, "data", "scenarios.json");
  return JSON.parse(readFileSync(p, "utf-8")) as { presets: ScenarioPreset[] };
}

export function loadOutcomes(): { outcomes: OutcomeDef[] } {
  const p = path.join(ROOT, "data", "outcomes.json");
  return JSON.parse(readFileSync(p, "utf-8")) as { outcomes: OutcomeDef[] };
}

const ACTION_VERBS = [
  "closes",
  "close",
  "closed",
  "blockade",
  "blockaded",
  "blocked",
  "strike",
  "struck",
  "drought",
  "eruption",
  "erupts",
  "cutoff",
  "cut off",
  "hurricane",
  "typhoon",
  "shutdown",
  "shut",
  "halts",
  "halted",
  "disrupted",
  "disruption",
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function scoreNode(tokens: string[], nodeId: string, name: string, aliases: string[] = []): number {
  const hay = [nodeId, name, ...aliases].map((s) => s.toLowerCase());
  let score = 0;
  for (const t of tokens) {
    if (t.length < 3) continue;
    for (const h of hay) {
      if (h.includes(t) || t.includes(h.replace(/\s+/g, "-"))) score += 2;
      // multi-word: "hormuz", "suez", "panama", "taiwan"
      if (h.split(/[\s\-]/).some((w) => w === t)) score += 3;
    }
  }
  return score;
}

function detectDisruptionType(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("drought")) return "drought";
  if (t.includes("hurricane") || t.includes("typhoon") || t.includes("storm"))
    return "hurricane";
  if (t.includes("erupt")) return "eruption";
  if (t.includes("strike")) return "strike";
  if (t.includes("cut off") || t.includes("cutoff") || t.includes("cut-off"))
    return "cutoff";
  if (t.includes("block") || t.includes("close") || t.includes("halt"))
    return "blockade";
  return "disruption";
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function reachableCommodities(
  wm: WorldModel,
  epicenter: string,
  maxHops = 4
): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of wm.edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
  }
  const visited = new Set<string>();
  const q: { id: string; hops: number }[] = [{ id: epicenter, hops: 0 }];
  const commodities = new Set<string>();

  while (q.length) {
    const { id, hops } = q.shift()!;
    if (visited.has(id) || hops > maxHops) continue;
    visited.add(id);
    const node = wm.nodes.find((n) => n.id === id);
    for (const c of node?.commodities ?? []) commodities.add(c);
    for (const to of adj.get(id) ?? []) {
      if (!visited.has(to)) q.push({ id: to, hops: hops + 1 });
    }
  }
  return commodities;
}

function screenOutcomes(
  epicenter: string,
  wm: WorldModel,
  preferred?: string[]
): AffectedOutcome[] {
  const { outcomes } = loadOutcomes();
  const commodities = reachableCommodities(wm, epicenter);
  const laneTypes = new Set(
    wm.edges
      .filter((e) => e.from === epicenter || e.to === epicenter || commodities.has(e.commodity ?? ""))
      .map((e) => e.lane_type ?? "sea")
  );

  const scored = outcomes.map((o) => {
    let score = 0;
    for (const c of o.commodities) if (commodities.has(c)) score += 3;
    for (const lt of o.lane_types) if (laneTypes.has(lt as "sea" | "air")) score += 1;
    if (preferred?.includes(o.id)) score += 5;
    // air outcome if any air edges exist near epicenter region
    if (o.id === "air_travel") {
      const hasAir = wm.edges.some(
        (e) =>
          e.lane_type === "air" &&
          (e.from === epicenter ||
            e.to === epicenter ||
            wm.nodes.find((n) => n.id === e.from)?.region ===
              wm.nodes.find((n) => n.id === epicenter)?.region)
      );
      if (hasAir) score += 2;
    }
    const direction =
      o.direction_hint === "up"
        ? ("up" as const)
        : o.direction_hint === "down"
          ? ("down" as const)
          : ("volatile" as const);
    return {
      id: o.id,
      name: o.name,
      direction,
      confidence: Math.min(0.95, 0.35 + score * 0.08),
      reason: `Linked via ${o.commodities.filter((c) => commodities.has(c)).join(", ") || "network proximity"}`,
      visual: o.visual,
      markets: o.markets,
      _score: score,
    };
  });

  return scored
    .filter((o) => o._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 6)
    .map((o) => ({
      id: o.id,
      name: o.name,
      direction: o.direction,
      confidence: o.confidence,
      reason: o.reason,
      visual: o.visual,
      markets: o.markets,
    }));
}

export function matchScenario(opts: {
  text?: string;
  preset_id?: string;
}): ScenarioMatch {
  const wm = loadWorldModel();
  const { presets } = loadScenarios();

  if (opts.preset_id) {
    const preset = presets.find((p) => p.id === opts.preset_id);
    if (!preset) throw new Error(`Unknown preset: ${opts.preset_id}`);
    const node = wm.nodes.find((n) => n.id === preset.epicenter_node);
    if (!node) throw new Error(`Epicenter missing: ${preset.epicenter_node}`);
    const outcomes = screenOutcomes(
      preset.epicenter_node,
      wm,
      preset.default_outcomes
    );
    const event: FixtureEvent = {
      id: `evt-${preset.id}-${uid("s").slice(-6)}`,
      ts: new Date().toISOString(),
      title: preset.label,
      summary: preset.text,
      source: "scenario-preset",
      epicenter_node: preset.epicenter_node,
      lat: node.lat,
      lng: node.lng,
      implied_probability: preset.implied_probability,
      markets: preset.markets,
      news_headlines: preset.news_headlines,
    };
    return {
      scenario_id: uid("scn"),
      preset_id: preset.id,
      text: preset.text,
      epicenter_nodes: [preset.epicenter_node],
      disruption_type: preset.disruption_type,
      severity: preset.severity,
      implied_probability: preset.implied_probability,
      affected_outcomes: outcomes,
      event,
    };
  }

  const text = (opts.text ?? "").trim();
  if (!text) throw new Error("Provide text or preset_id");

  const tokens = tokenize(text);
  let best = { id: "hormuz", score: 0 };
  for (const n of wm.nodes) {
    const s = scoreNode(tokens, n.id, n.name, n.aliases ?? []);
    if (s > best.score) best = { id: n.id, score: s };
  }

  // Prefer matching a known preset if text is close
  let matchedPreset: ScenarioPreset | undefined;
  for (const p of presets) {
    const labelTokens = tokenize(p.label + " " + p.text);
    const overlap = tokens.filter((t) => labelTokens.includes(t)).length;
    if (overlap >= 3) {
      matchedPreset = p;
      break;
    }
  }

  if (matchedPreset) {
    return matchScenario({ preset_id: matchedPreset.id });
  }

  if (best.score === 0) {
    throw new Error(
      "Couldn't parse a location from that text — pick a preset or name a chokepoint (Hormuz, Taiwan, Panama, Bab el-Mandeb…)."
    );
  }

  const node = wm.nodes.find((n) => n.id === best.id)!;
  const disruption_type = detectDisruptionType(text);
  const hasAction = ACTION_VERBS.some((v) => text.toLowerCase().includes(v));
  const severity = hasAction ? 0.85 : 0.65;
  const outcomes = screenOutcomes(best.id, wm);
  const rand = mulberry32(hashSeed(text + "|" + best.id));

  const markets: FixtureMarket[] = outcomes
    .flatMap((o) => o.markets)
    .filter((id, i, arr) => arr.indexOf(id) === i)
    .slice(0, 4)
    .map((id) => {
      const fromWm = wm.markets.find((m) => m.id === id);
      return {
        id,
        question: fromWm?.question ?? `Will ${id} move on this disruption?`,
        yes_price: 0.4 + rand() * 0.15,
        no_price: 0.45,
        volume_24h: 400000,
        zero_service: "prediction-market-odds",
      };
    });

  // ensure markets have sensible no_price
  for (const m of markets) {
    m.no_price = Math.round((1 - m.yes_price) * 100) / 100;
    m.yes_price = Math.round(m.yes_price * 100) / 100;
  }

  const event: FixtureEvent = {
    id: uid("evt"),
    ts: new Date().toISOString(),
    title: text.length > 80 ? text.slice(0, 77) + "…" : text,
    summary: text,
    source: "scenario-text",
    epicenter_node: best.id,
    lat: node.lat,
    lng: node.lng,
    implied_probability: Math.min(0.9, 0.45 + severity * 0.3),
    markets:
      markets.length > 0
        ? markets
        : [
            {
              id: "mkt-brent-above-85",
              question: "Will Brent crude settle above $85/bbl this month?",
              yes_price: 0.52,
              no_price: 0.48,
              volume_24h: 500000,
              zero_service: "prediction-market-odds",
            },
          ],
    news_headlines: [
      `Markets react to reported disruption near ${node.name}`,
      "Shipping desks reassess routing and war-risk cover",
    ],
  };

  return {
    scenario_id: uid("scn"),
    text,
    epicenter_nodes: [best.id],
    disruption_type,
    severity,
    implied_probability: event.implied_probability,
    affected_outcomes: outcomes,
    event,
  };
}

export function getPresetList(): { id: string; label: string; text: string }[] {
  return loadScenarios().presets.map((p) => ({
    id: p.id,
    label: p.label,
    text: p.text,
  }));
}
