/**
 * ChainAlpha deterministic impact engine.
 *
 * Given a (possibly secondary-merged) ScenarioDefinition and the semiconductor
 * IndustryModel, derives operational, per-company, and financial impact — plus the
 * trade proposals (block-worthy initial, resized approved, and a Japan-shock revised
 * strategy) and portfolio direction/severity updates.
 *
 * Everything here is PURE and deterministic: identical inputs always yield identical
 * outputs (no Math.random, no Date-dependent branches, no I/O). This is what makes the
 * replay demo reliable and the "plan invalidated & recomputed" beat reproducible.
 */

import type {
  CompanyImpact,
  CompanyProfile,
  FinancialImpact,
  ImpactAssumption,
  IndustryModel,
  OperationalImpact,
  PortfolioPosition,
  ScenarioDefinition,
  ScenarioShock,
  TradeProposal,
} from "./types";

// ─── numeric helpers ───────────────────────────────────────

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round0 = (n: number) => Math.round(n);
const round2 = (n: number) => Math.round(n * 100) / 100;
const roundUsd = (n: number) => Math.round(n / 1_000_000) * 1_000_000;
const roundK = (n: number) => Math.round(n / 1000) * 1000;

const SEV_MULT: Record<CompanyProfile["baseSeverity"], number> = {
  low: 0.5,
  medium: 0.8,
  high: 1.0,
  critical: 1.2,
};

/** Largest absolute shock magnitude among shocks matching a predicate. */
function shockMag(shocks: ScenarioShock[], pred: (s: ScenarioShock) => boolean): number {
  let m = 0;
  for (const s of shocks) if (pred(s)) m = Math.max(m, Math.abs(s.changePercent));
  return m;
}

export interface ShockProfile {
  mfg: number;
  pkg: number;
  ship: number;
  materials: number;
  alt: number;
  /** blended manufacturing-side severity */
  mfgComposite: number;
}

export function extractShockProfile(shocks: ScenarioShock[]): ShockProfile {
  const mfg = shockMag(shocks, (s) => s.metric.includes("manufacturing"));
  const pkg = shockMag(shocks, (s) => s.metric.includes("packaging"));
  const ship = shockMag(
    shocks,
    (s) => s.metric.includes("shipping") || s.targetId.includes("strait")
  );
  const materials = shockMag(
    shocks,
    (s) => s.metric.includes("export") || s.metric.includes("delivery")
  );
  const alt = shockMag(shocks, (s) => s.metric.includes("alternative"));
  const mfgComposite = 0.7 * mfg + 0.3 * pkg;
  return { mfg, pkg, ship, materials, alt, mfgComposite };
}

/** Node ids that are directly disrupted (node-shock targets + epicenter). */
export function disruptedNodeIds(scenario: ScenarioDefinition): string[] {
  const ids = new Set<string>();
  if (scenario.epicenterNode) ids.add(scenario.epicenterNode);
  for (const s of scenario.shocks) if (s.targetType === "node") ids.add(s.targetId);
  return [...ids];
}

// ─── operational impact ────────────────────────────────────

export function computeOperationalImpact(
  scenario: ScenarioDefinition,
  industry: IndustryModel
): OperationalImpact {
  const sp = extractShockProfile(scenario.shocks);
  const duration = scenario.durationDays;

  const supplyReductionPercent = clamp(
    round0(sp.mfgComposite * 0.8 + sp.ship * 0.2 + (sp.materials + sp.alt) * 0.1),
    0,
    92
  );

  const deliveryDelayDays = clamp(
    round0(sp.ship * 0.45 + duration * 0.7 + sp.materials * 0.25),
    0,
    240
  );

  // Inventory coverage keys off the thinnest buffer on the disrupted critical path.
  const invByNode = new Map(industry.worldModel.nodes.map((n) => [n.id, n.inventoryDays]));
  const disrupted = disruptedNodeIds(scenario);
  const buffers = disrupted
    .map((id) => invByNode.get(id))
    .filter((d): d is number => typeof d === "number");
  const minInventory = buffers.length ? Math.min(...buffers) : 20;
  const inventoryCoverageDays = clamp(
    round0(minInventory * (1 - supplyReductionPercent / 1000)),
    1,
    minInventory
  );

  const shortageProbability = clamp(
    round2(0.35 + (supplyReductionPercent / 100) * 0.75 + (sp.materials / 100) * 0.1),
    0,
    0.95
  );

  const recoveryMinDays = round0(duration * 1.5 + supplyReductionPercent * 0.25);
  const recoveryMaxDays = round0(
    duration * 2.2 + supplyReductionPercent * 0.6 + sp.materials * 0.4
  );

  return {
    supplyReductionPercent,
    deliveryDelayDays,
    inventoryCoverageDays,
    shortageProbability,
    recoveryMinDays,
    recoveryMaxDays,
  };
}

// ─── company impact ────────────────────────────────────────

const NEG_REASON_INTC =
  "Japan equipment & photoresist export limits choke Intel's US foundry ramp — the alternative-capacity thesis is invalidated; Intel now faces the same input constraints it was meant to relieve.";

export function computeCompanyImpacts(
  scenario: ScenarioDefinition,
  industry: IndustryModel,
  operational: OperationalImpact,
  secondaryApplied: boolean
): CompanyImpact[] {
  const intensity = operational.supplyReductionPercent / 100;
  const baseFraction = 0.04;

  return industry.companies.map((profile) => {
    let direction: CompanyImpact["direction"] = profile.baseDirection;
    let severity: CompanyImpact["severity"] = profile.baseSeverity;
    let reason = profile.reason;

    // Intel is the swing name: a beneficiary while the disruption is Taiwan-only,
    // but flips negative once Japanese replacement capacity is restricted.
    if (profile.companyId === "INTC" && secondaryApplied) {
      direction = "negative";
      severity = "high";
      reason = NEG_REASON_INTC;
    }
    // The alternative-capacity provider also degrades under the secondary shock.
    if (profile.companyId === "ASML" && secondaryApplied) {
      severity = "medium";
      reason =
        "Litho tool installs at Intel/US slip further as the Japan restriction stalls fab build-out; mixed near-term impact deepens.";
    }

    const beneficiary = direction === "positive";
    const sevMult = SEV_MULT[severity];
    let max =
      profile.revenueScaleUsd *
      profile.exposureWeight *
      intensity *
      baseFraction *
      sevMult;
    if (beneficiary) max *= 0.5; // upside sizing is more conservative than downside risk
    const min = max * 0.55;

    // Company-level recovery scales the operational envelope by exposure.
    const recoveryMinDays = round0(
      operational.recoveryMinDays * (0.6 + 0.4 * profile.exposureWeight)
    );
    const recoveryMaxDays = round0(
      operational.recoveryMaxDays * (0.7 + 0.3 * profile.exposureWeight)
    );

    return {
      companyId: profile.companyId,
      companyName: profile.companyName,
      direction,
      severity,
      revenueImpactMinUsd: roundUsd(min),
      revenueImpactMaxUsd: roundUsd(max),
      recoveryMinDays,
      recoveryMaxDays,
      reason,
    };
  });
}

// ─── financial impact ──────────────────────────────────────

export function computeFinancialImpact(
  companies: CompanyImpact[],
  operational: OperationalImpact,
  scenario: ScenarioDefinition,
  secondaryApplied: boolean
): FinancialImpact {
  const negative = companies.filter((c) => c.direction === "negative");
  const revenueAtRiskMinUsd = roundUsd(
    negative.reduce((a, c) => a + c.revenueImpactMinUsd, 0)
  );
  const revenueAtRiskMaxUsd = roundUsd(
    negative.reduce((a, c) => a + c.revenueImpactMaxUsd, 0)
  );

  const sr = operational.supplyReductionPercent;
  const grossMarginImpactMinPoints = round2(sr * 0.05);
  const grossMarginImpactMaxPoints = round2(sr * 0.12);

  // Estimated semiconductor-index move is a drawdown range (min = deeper, max = shallower).
  const estimatedMarketMoveMinPercent = round2(-(sr * 0.25));
  const estimatedMarketMoveMaxPercent = round2(-(sr * 0.09));

  const confidence = round2(clamp(0.74 - (secondaryApplied ? 0.16 : 0), 0.3, 0.95));

  const sp = extractShockProfile(scenario.shocks);
  const assumptions: ImpactAssumption[] = [
    {
      id: "fab-downtime",
      label: "Leading-edge fab downtime",
      value: `${scenario.durationDays}d hard shutdown + ramp`,
      sensitivity: "high",
    },
    {
      id: "cowos-bottleneck",
      label: "CoWoS advanced-packaging bottleneck",
      value: `${round0(sp.pkg || sp.mfgComposite)}% capacity loss, no near-term substitute`,
      sensitivity: "high",
    },
    {
      id: "inventory-buffer",
      label: "Channel inventory buffer",
      value: `${operational.inventoryCoverageDays}d of coverage before shortage`,
      sensitivity: "medium",
    },
    {
      id: "substitution-capacity",
      label: "Substitution / alternative capacity",
      value: secondaryApplied
        ? "US + Malaysia alternatives now constrained by Japan restriction"
        : "US (Intel) + Malaysia absorb a fraction of demand",
      sensitivity: secondaryApplied ? "high" : "medium",
    },
    {
      id: "litho-lead-time",
      label: "EUV / DUV litho lead time",
      value: "180–200d — no capacity add within the horizon",
      sensitivity: "low",
    },
    {
      id: "strait-logistics",
      label: "Taiwan Strait logistics",
      value: `${round0(100 - sp.ship)}% of normal outbound shipping`,
      sensitivity: "medium",
    },
  ];

  return {
    revenueAtRiskMinUsd,
    revenueAtRiskMaxUsd,
    grossMarginImpactMinPoints,
    grossMarginImpactMaxPoints,
    estimatedMarketMoveMinPercent,
    estimatedMarketMoveMaxPercent,
    confidence,
    assumptions,
  };
}

// ─── portfolio direction / severity ────────────────────────

function severityFromScore(score: number): PortfolioPosition["severity"] {
  if (score >= 0.85) return "critical";
  if (score >= 0.6) return "high";
  if (score >= 0.32) return "medium";
  if (score >= 0.12) return "low";
  return "none";
}

export function updatePortfolio(
  seed: PortfolioPosition[],
  companies: CompanyImpact[],
  industry: IndustryModel,
  operational: OperationalImpact
): PortfolioPosition[] {
  const intensity = operational.supplyReductionPercent / 100;
  const byCompany = new Map(companies.map((c) => [c.companyId, c]));
  const betaById = new Map(industry.portfolio.map((p) => [p.id, p.shockBeta]));

  return seed.map((pos) => {
    const impact = byCompany.get(pos.id);
    const beta = betaById.get(pos.id) ?? 0;

    let direction: PortfolioPosition["direction"];
    let severity: PortfolioPosition["severity"];

    if (impact) {
      direction = impact.direction;
      // Prefer the company severity, but keep it consistent with position beta strength.
      severity =
        impact.direction === "positive"
          ? severityFromScore(Math.abs(beta) * intensity * 0.7)
          : impact.severity === "critical"
            ? "critical"
            : impact.severity;
    } else {
      // e.g. SOXX — no company profile, drive purely off shock beta.
      direction = beta < 0 ? "negative" : beta > 0 ? "positive" : "neutral";
      severity = severityFromScore(Math.abs(beta) * intensity);
    }

    return {
      id: pos.id,
      name: pos.name,
      exposureUsd: pos.exposureUsd,
      portfolioPercent: pos.portfolioPercent,
      direction,
      severity,
    };
  });
}

// ─── trade proposals ───────────────────────────────────────

export interface ProposalSet {
  initial: TradeProposal;
  primaryRevised: TradeProposal;
  secondaryRevised?: TradeProposal;
}

export function buildProposals(args: {
  financial: FinancialImpact;
  bookValueUsd: number;
  secondaryApplied: boolean;
}): ProposalSet {
  const { financial, bookValueUsd, secondaryApplied } = args;
  const avgAbsMove =
    (Math.abs(financial.estimatedMarketMoveMinPercent) +
      Math.abs(financial.estimatedMarketMoveMaxPercent)) /
    2;
  const expectedPnl = (capture: number) =>
    roundK(bookValueUsd * (avgAbsMove / 100) * capture);

  // 1) Aggressive base playbook — oversized notional, high drawdown → Pomerium blocks it.
  const initial: TradeProposal = {
    revision: 1,
    actions: [
      {
        asset: "NVDA",
        action: "reduce",
        positionChangePercent: -45,
        thesis: "Cut leading-edge GPU exposure ahead of the multi-week Taiwan fab shutdown.",
      },
      {
        asset: "INTC",
        action: "increase",
        positionChangePercent: 35,
        thesis: "Rotate into US foundry capacity as the scarce alternative source.",
      },
      {
        asset: "SOXX",
        action: "hedge",
        positionChangePercent: -60,
        thesis: "Overlay a large semi-index short / put hedge against a supply-driven drawdown.",
      },
    ],
    expectedPnlUsd: expectedPnl(0.3),
    maxDrawdownPercent: 34,
    confidence: 0.55,
    status: "proposed",
    notionalUsd: 5.0,
    violatedLimit: "max_position / max_drawdown",
  };

  // 2) Risk-resized plan — within stake limit, lower drawdown → Pomerium approves.
  const primaryRevised: TradeProposal = {
    revision: 2,
    actions: [
      {
        asset: "NVDA",
        action: "reduce",
        positionChangePercent: -20,
        thesis: "Trim GPU concentration while keeping core structural exposure.",
      },
      {
        asset: "INTC",
        action: "increase",
        positionChangePercent: 18,
        thesis: "Add measured US-foundry exposure as an alternative-capacity beneficiary.",
      },
      {
        asset: "SOXX",
        action: "hedge",
        positionChangePercent: -35,
        thesis: "Right-size the semi-index hedge to cap drawdown within policy limits.",
      },
    ],
    expectedPnlUsd: expectedPnl(0.16),
    maxDrawdownPercent: 12,
    confidence: 0.7,
    status: "proposed",
    notionalUsd: 1.5,
  };

  let secondaryRevised: TradeProposal | undefined;
  if (secondaryApplied) {
    // 3) Post-Japan revision — the Intel increase is cut (Intel now hurt); lean on the hedge.
    secondaryRevised = {
      revision: 3,
      actions: [
        {
          asset: "NVDA",
          action: "reduce",
          positionChangePercent: -22,
          thesis: "Hold the GPU trim; downside is deeper with alternatives constrained.",
        },
        {
          asset: "INTC",
          action: "reduce",
          positionChangePercent: -12,
          thesis: "Cut the earlier Intel add — Japanese export limits choke its US ramp too.",
        },
        {
          asset: "SOXX",
          action: "hedge",
          positionChangePercent: -50,
          thesis: "Lean harder on the broad semi-index hedge as substitution capacity fails.",
        },
      ],
      expectedPnlUsd: expectedPnl(0.18),
      maxDrawdownPercent: 15,
      confidence: 0.6,
      status: "proposed",
      notionalUsd: 1.5,
    };
  }

  return { initial, primaryRevised, secondaryRevised };
}

// ─── convenience bundle ────────────────────────────────────

export interface ScenarioImpactBundle {
  operational: OperationalImpact;
  companies: CompanyImpact[];
  financial: FinancialImpact;
  portfolio: PortfolioPosition[];
  proposals: ProposalSet;
  confidence: number;
}

export function bookValueUsd(industry: IndustryModel): number {
  return industry.portfolio.reduce((a, p) => a + p.exposureUsd, 0);
}

/**
 * Full deterministic impact bundle for a (possibly merged) scenario.
 * `seed` is the neutral pre-shock portfolio from seedPortfolio(industry).
 */
export function computeScenarioImpact(
  scenario: ScenarioDefinition,
  industry: IndustryModel,
  seed: PortfolioPosition[],
  secondaryApplied: boolean
): ScenarioImpactBundle {
  const operational = computeOperationalImpact(scenario, industry);
  const companies = computeCompanyImpacts(scenario, industry, operational, secondaryApplied);
  const financial = computeFinancialImpact(companies, operational, scenario, secondaryApplied);
  const portfolio = updatePortfolio(seed, companies, industry, operational);
  const proposals = buildProposals({
    financial,
    bookValueUsd: bookValueUsd(industry),
    secondaryApplied,
  });
  return {
    operational,
    companies,
    financial,
    portfolio,
    proposals,
    confidence: financial.confidence,
  };
}

/** Merge a secondary scenario's shocks into the primary (deterministic union). */
export function mergeScenario(
  primary: ScenarioDefinition,
  secondary?: ScenarioDefinition
): ScenarioDefinition {
  if (!secondary) return primary;
  return {
    ...primary,
    shocks: [...primary.shocks, ...secondary.shocks],
    // Keep the primary epicenter / duration; the secondary contributes constraints only.
    alternativeNodes: (primary.alternativeNodes ?? []).filter(
      (id) => !secondary.shocks.some((s) => s.targetType === "node" && s.targetId === id)
    ),
    secondaryShockId: secondary.id,
  };
}
