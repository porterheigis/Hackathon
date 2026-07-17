/**
 * ChainAlpha scenario + industry loaders.
 * Industry graphs live in data/industries/*.json; curated scenarios in data/scenarios/*.json.
 * The legacy Red Sea world model (data/world-model.json) is preserved and exposed as a
 * secondary curated scenario so it remains available.
 */

import { readFileSync } from "fs";
import path from "path";
import type {
  IndustryModel,
  PortfolioPosition,
  ScenarioDefinition,
  WorldModel,
} from "./types";

const ROOT = process.cwd();

function readJson<T>(...segments: string[]): T {
  const p = path.join(ROOT, ...segments);
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

/** Semiconductor industry: graph + portfolio + company profiles */
export function loadIndustry(industryId = "semiconductors"): IndustryModel {
  return readJson<IndustryModel>("data", "industries", `${industryId}.json`);
}

/** Load a world graph by id. "red-sea" maps to the preserved legacy world model. */
export function loadWorldModelById(worldModelId: string): WorldModel {
  if (worldModelId === "red-sea") {
    return readJson<WorldModel>("data", "world-model.json");
  }
  return loadIndustry(worldModelId).worldModel;
}

const SCENARIO_FILES: Record<string, string> = {
  "taiwan-earthquake": "taiwan-earthquake.json",
  "taiwan-strait-closure": "taiwan-strait-closure.json",
  "japan-export-restriction": "japan-export-restriction.json",
};

export function loadScenario(scenarioId: string): ScenarioDefinition {
  const file = SCENARIO_FILES[scenarioId];
  if (file) {
    return readJson<ScenarioDefinition>("data", "scenarios", file);
  }
  if (scenarioId === "red-sea") {
    return redSeaScenario();
  }
  // Unknown id — fall back to the primary demo scenario.
  return readJson<ScenarioDefinition>("data", "scenarios", "taiwan-earthquake.json");
}

export const DEFAULT_SCENARIO_ID = "taiwan-earthquake";

/** Curated scenarios shown in the composer selector. */
export function curatedScenarios(): Array<{ id: string; title: string }> {
  return [
    { id: "taiwan-earthquake", title: "Taiwan Earthquake (default)" },
    { id: "taiwan-strait-closure", title: "Taiwan Strait Closure" },
    { id: "red-sea", title: "Red Sea Shipping (legacy)" },
  ];
}

/**
 * Red Sea scenario adapted onto the preserved legacy world model.
 * Modelled as a logistics shock (milder, mostly-negative-low) so the semiconductor
 * portfolio still receives coherent, deterministic impacts.
 */
export function redSeaScenario(): ScenarioDefinition {
  return {
    id: "red-sea",
    industry: "semiconductors",
    worldModelId: "red-sea",
    targetCompany: "SOXX",
    title: "Red Sea shipping disruption — Asia–Europe logistics premium",
    prompt:
      "Carriers divert around the Cape of Good Hope after renewed Red Sea attacks near Bab el-Mandeb. Asia–Europe container capacity falls ~35% and lead times stretch. Model the logistics-cost impact on semiconductor shipments and propose a hedged trade.",
    eventType: "shipping-disruption",
    epicenterNode: "bab-el-mandeb",
    durationDays: 30,
    horizonDays: 84,
    shocks: [
      { targetType: "node", targetId: "bab-el-mandeb", metric: "shipping_capacity", changePercent: -55 },
      { targetType: "edge", targetId: "e1", metric: "shipping_capacity", changePercent: -35 },
      { targetType: "edge", targetId: "e2", metric: "shipping_capacity", changePercent: -35 },
      { targetType: "edge", targetId: "e3", metric: "shipping_capacity", changePercent: -30 },
    ],
    source: "curated",
    alternativeNodes: ["panama", "gibraltar"],
    beneficiaryNodes: [],
  };
}

/** Portfolio seed → live PortfolioPosition rows (pre-shock, neutral). */
export function seedPortfolio(industry: IndustryModel): PortfolioPosition[] {
  return industry.portfolio.map((p) => ({
    id: p.id,
    name: p.name,
    exposureUsd: p.exposureUsd,
    portfolioPercent: p.portfolioPercent,
    direction: "neutral",
    severity: "none",
  }));
}
