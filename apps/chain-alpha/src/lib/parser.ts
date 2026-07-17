/**
 * Deterministic replay-mode scenario parser.
 *
 * Recognises earthquakes, Taiwan / Japan geographies, port or strait closures,
 * production- and shipping-capacity changes, export restrictions, durations in
 * days or weeks, company names, and a simulation horizon.
 *
 * There is NO randomness here — the same prompt always yields the same scenario,
 * which is what makes the replay demo reliable. An optional live LLM parser can be
 * layered on later behind env vars, but replay mode must never depend on it.
 */

import { loadScenario, redSeaScenario } from "./scenarios";
import type { ScenarioDefinition, ScenarioShock } from "./types";

export interface ParseResult {
  scenario: ScenarioDefinition;
  confidence: number;
  source: "curated" | "parsed" | "fallback";
}

export interface ParseInput {
  prompt?: string;
  scenarioId?: string;
  industry?: string;
  company?: string;
  horizonDays?: number;
}

const COMPANY_ALIASES: Record<string, string> = {
  nvidia: "NVDA",
  nvda: "NVDA",
  amd: "AMD",
  tsmc: "TSM",
  tsm: "TSM",
  intel: "INTC",
  intc: "INTC",
  asml: "ASML",
  soxx: "SOXX",
};

/** Pull the first "N weeks" / "N days" duration out of free text (days). */
function parseDurationDays(text: string): number | null {
  const weeks = text.match(/(\d+(?:\.\d+)?)\s*(?:-|\s)?week/i);
  if (weeks) return Math.round(parseFloat(weeks[1]) * 7);
  const days = text.match(/(\d+(?:\.\d+)?)\s*(?:-|\s)?day/i);
  if (days) return Math.round(parseFloat(days[1]));
  const months = text.match(/(\d+(?:\.\d+)?)\s*(?:-|\s)?month/i);
  if (months) return Math.round(parseFloat(months[1]) * 30);
  return null;
}

/** Simulation horizon like "12 week horizon" / "over 12 weeks". */
function parseHorizonDays(text: string): number | null {
  const m = text.match(/(\d+)\s*(?:-|\s)?week[s]?\s*(?:horizon|simulation|out|window)/i);
  if (m) return parseInt(m[1], 10) * 7;
  const h = text.match(/horizon[^0-9]{0,12}(\d+)\s*week/i);
  if (h) return parseInt(h[1], 10) * 7;
  return null;
}

/** Percent near a keyword group, e.g. "shipping capacity falls by 40%". */
function parsePercentNear(text: string, keywords: string[]): number | null {
  for (const kw of keywords) {
    const re = new RegExp(
      `${kw}[^%]{0,40}?(\\d{1,3})\\s*%|(\\d{1,3})\\s*%[^%]{0,40}?${kw}`,
      "i"
    );
    const m = text.match(re);
    if (m) {
      const val = parseInt(m[1] ?? m[2], 10);
      if (!Number.isNaN(val)) return val;
    }
  }
  return null;
}

function detectCompany(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [alias, id] of Object.entries(COMPANY_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`, "i").test(lower)) return id;
  }
  return null;
}

function overrideShock(
  shocks: ScenarioShock[],
  metricMatch: (s: ScenarioShock) => boolean,
  changePercent: number
): ScenarioShock[] {
  let touched = false;
  const next = shocks.map((s) => {
    if (metricMatch(s)) {
      touched = true;
      return { ...s, changePercent: -Math.abs(changePercent) };
    }
    return s;
  });
  return touched ? next : shocks;
}

/**
 * Choose the nearest curated base scenario for free-text input.
 * Returns the base id and a base confidence for a clean keyword match.
 */
function pickBase(text: string): { id: string; confidence: number } {
  const t = text.toLowerCase();
  const taiwan = /taiwan|hsinchu|tsmc/.test(t);
  const japan = /japan|tokyo|shin-etsu|photoresist/.test(t);
  const strait = /strait|blockade|closure|closed|naval/.test(t);
  const quake = /earthquake|quake|seismic|richter/.test(t);
  const exportR = /export restriction|export control|export ban|restrict/.test(t);
  const redSea = /red sea|bab[- ]el|houthi|suez|cape of good hope/.test(t);

  if (redSea) return { id: "red-sea", confidence: 0.82 };
  if (japan && exportR) return { id: "japan-export-restriction", confidence: 0.8 };
  if (taiwan && quake) return { id: "taiwan-earthquake", confidence: 0.88 };
  if (taiwan && strait) return { id: "taiwan-strait-closure", confidence: 0.84 };
  if (quake) return { id: "taiwan-earthquake", confidence: 0.7 };
  if (strait) return { id: "taiwan-strait-closure", confidence: 0.68 };
  // No strong signal.
  return { id: "taiwan-earthquake", confidence: 0.35 };
}

function baseScenario(id: string): ScenarioDefinition {
  return id === "red-sea" ? redSeaScenario() : loadScenario(id);
}

export function parseScenario(input: ParseInput): ParseResult {
  // 1) Explicit curated selection — highest confidence.
  if (input.scenarioId) {
    const scenario = baseScenario(input.scenarioId);
    const withOverrides = applyTopLevelOverrides(scenario, input, "curated");
    return { scenario: withOverrides, confidence: 0.95, source: "curated" };
  }

  const prompt = (input.prompt ?? "").trim();

  // 2) No prompt at all — deterministic default.
  if (!prompt) {
    const scenario = applyTopLevelOverrides(
      baseScenario("taiwan-earthquake"),
      input,
      "curated"
    );
    return { scenario, confidence: 0.9, source: "curated" };
  }

  // 3) Free-text parse.
  const { id, confidence } = pickBase(prompt);
  const base = baseScenario(id);
  const fallback = confidence < 0.5;

  const durationDays = parseDurationDays(prompt);
  const horizonDays = input.horizonDays ?? parseHorizonDays(prompt);
  const productionPct = parsePercentNear(prompt, [
    "production",
    "manufacturing",
    "capacity",
    "output",
  ]);
  const shippingPct = parsePercentNear(prompt, [
    "shipping",
    "strait",
    "logistics",
    "container",
    "port",
  ]);

  let shocks = base.shocks;
  if (productionPct != null) {
    shocks = overrideShock(
      shocks,
      (s) => s.metric.includes("manufacturing") || s.metric.includes("packaging"),
      productionPct
    );
  }
  if (shippingPct != null) {
    shocks = overrideShock(
      shocks,
      (s) => s.metric.includes("shipping") || s.targetId.includes("strait"),
      shippingPct
    );
  }

  const parsed: ScenarioDefinition = {
    ...base,
    // Preserve the operator's original words verbatim.
    prompt,
    durationDays: durationDays ?? base.durationDays,
    horizonDays: horizonDays ?? base.horizonDays,
    targetCompany: detectCompany(prompt) ?? input.company ?? base.targetCompany,
    shocks,
    source: fallback ? "curated" : "parsed",
  };

  return {
    scenario: parsed,
    confidence: fallback ? 0.35 : confidence,
    source: fallback ? "fallback" : "parsed",
  };
}

function applyTopLevelOverrides(
  scenario: ScenarioDefinition,
  input: ParseInput,
  source: ScenarioDefinition["source"]
): ScenarioDefinition {
  return {
    ...scenario,
    source,
    targetCompany: input.company ?? scenario.targetCompany,
    horizonDays: input.horizonDays ?? scenario.horizonDays,
  };
}
