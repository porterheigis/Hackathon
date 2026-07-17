/**
 * ChainAlpha orchestrator — INGEST → MODEL → SIMULATE → RISK → EXECUTE → SETTLE.
 *
 * Turns a physical-world supply-chain disruption into a deterministic, agentic
 * investment simulation. Streams full FundState snapshots to the UI and exercises all
 * four sponsor integrations: Zero (capability discovery + wallet), Nexla (world-model +
 * position book), Akash (Monte-Carlo scenario sim), Pomerium (stake-limit risk gate).
 *
 * Deterministic in replay: no Math.random in scenario logic; the same scenario always
 * produces the same beats and the same numbers.
 */

import { deriveNetworkStatuses, runScenarioSimulation } from "./adapters/akash";
import {
  getPositions,
  ingestTransportSnapshot,
  logSignal,
  mapTransportAssetsToRoutes,
  recordFill,
  recordTransportBaseline,
  writeThesis,
} from "./adapters/nexla";
import { gateExecuteTrade, MAX_STAKE_USD } from "./adapters/pomerium";
import { computeTransportImpact } from "./live-transport/exposure";
import type { LiveTransportSnapshot } from "./live-transport/types";
import {
  executeViaZero,
  getDiscoveredCapabilities,
  getZeroWallet,
  ingestViaZero,
  resetZeroWallet,
} from "./adapters/zero";
import { computeScenarioImpact, extractShockProfile, mergeScenario } from "./impact";
import { loadIndustry, loadWorldModelById, seedPortfolio } from "./scenarios";
import { nowIso, resetPositionBook, sleep, uid } from "./store";
import type {
  FundState,
  OrchestratorEvent,
  PipelineStage,
  ScenarioDefinition,
  TapeEvent,
  TapeKind,
  Telemetry,
} from "./types";

export type EmitFn = (event: OrchestratorEvent) => void;

export interface RunPipelineOpts {
  replay?: boolean;
  scenario: ScenarioDefinition;
  secondaryShock?: ScenarioDefinition;
  parseConfidence?: number;
  parseSource?: "curated" | "parsed" | "fallback";
  /** Optional immutable live-transport baseline captured at run start (additive). */
  transportBaseline?: LiveTransportSnapshot;
}

// business-phase labels: 0 Baseline · 1 Event · 2 Inventory depletion ·
// 3 Impact peak · 4 Shortage · 5 Recovery · 6 Post-assessment
const PHASE = {
  BASELINE: 0,
  EVENT: 1,
  DEPLETION: 2,
  PEAK: 3,
  SHORTAGE: 4,
  RECOVERY: 5,
  POST: 6,
} as const;

function initialTelemetry(): Telemetry {
  const wallet = getZeroWallet();
  return {
    zeroSpendUsd: wallet.spend,
    zeroWalletUsd: wallet.balance,
    nexlaToolCalls: 0,
    pomeriumAllow: 0,
    pomeriumDeny: 0,
    akashLeaseId: "—",
    akashProvider: "—",
    akashEndpoint: "—",
    capabilitiesDiscovered: [],
  };
}

function makeTape(
  kind: TapeKind,
  stage: PipelineStage,
  message: string,
  agent?: string,
  meta?: Record<string, unknown>
): TapeEvent {
  return { id: uid("tape"), ts: nowIso(), kind, stage, message, agent, meta };
}

export function createInitialState(mode: "live" | "replay"): FundState {
  return {
    stage: "IDLE",
    mode,
    clearance: "TRADER",
    scenario: null,
    parseConfidence: 0,
    parseSource: "curated",
    secondaryShockApplied: false,
    worldModelId: "semiconductors",
    affectedNodes: [],
    affectedEdges: [],
    nodeStatuses: {},
    edgeStatuses: {},
    propagationOrder: [],
    propagationEvents: [],
    operational: null,
    companies: [],
    financial: null,
    sim: null,
    portfolio: [],
    proposals: [],
    positions: [],
    attemptedSize: null,
    approvedSize: null,
    lastDenial: null,
    businessPhase: PHASE.BASELINE,
    pnlUsd: 0,
    transportBaseline: null,
    exposedTransportAssets: [],
    transportImpact: null,
    telemetry: initialTelemetry(),
    tape: [],
  };
}

export async function runPipeline(emit: EmitFn, opts: RunPipelineOpts): Promise<FundState> {
  const mode = opts.replay ? "replay" : "live";
  const scenario = opts.scenario;
  const secondary = opts.secondaryShock;
  const secondaryApplied = Boolean(secondary);

  resetPositionBook();
  resetZeroWallet(5);

  const industry = loadIndustry(scenario.industry || "semiconductors");
  const world = loadWorldModelById(scenario.worldModelId || "semiconductors");
  const seed = seedPortfolio(industry);
  const merged = mergeScenario(scenario, secondary);
  const bundle = computeScenarioImpact(merged, industry, seed, secondaryApplied);
  const shockProfile = extractShockProfile(merged.shocks);

  let state = createInitialState(mode);
  state = {
    ...state,
    scenario,
    parseConfidence: opts.parseConfidence ?? 0.9,
    parseSource: opts.parseSource ?? "curated",
    secondaryShockApplied: secondaryApplied,
    worldModelId: scenario.worldModelId || "semiconductors",
    portfolio: seed,
  };

  const push = (partial: Partial<FundState>, tape?: TapeEvent) => {
    if (tape) {
      state = { ...state, ...partial, tape: [...state.tape, tape] };
      emit({ type: "tape", payload: tape });
    } else {
      state = { ...state, ...partial };
    }
    emit({ type: "state", payload: state });
  };

  const setStage = (stage: PipelineStage) => {
    push({ stage });
    emit({ type: "stage", payload: stage });
  };

  let nexlaCalls = 0;
  let pomAllow = 0;
  let pomDeny = 0;

  try {
    // ─── INGEST ───────────────────────────────────────────
    setStage("INGEST");
    push(
      { businessPhase: PHASE.BASELINE },
      makeTape(
        "plan",
        "INGEST",
        mode === "replay"
          ? "REPLAY — replaying scenario stream through the Zero capability mirror"
          : "Discovering data + execution capabilities via Zero…",
        "Scenario Interpreter"
      )
    );
    await sleep(400);

    const ingest = await ingestViaZero({ replay: opts.replay });
    const walletIngest = getZeroWallet();
    push(
      {
        telemetry: {
          ...state.telemetry,
          zeroSpendUsd: walletIngest.spend,
          zeroWalletUsd: walletIngest.balance,
          capabilitiesDiscovered: getDiscoveredCapabilities().map((c) => c.name),
        },
      },
      makeTape(
        "observe",
        "INGEST",
        `Zero capabilities discovered: ${ingest.capabilities
          .map((c) => c.name)
          .join(", ")} · spend $${ingest.spendUsd.toFixed(2)} (${ingest.source})`,
        "Scenario Interpreter",
        { capabilities: ingest.capabilities }
      )
    );
    await sleep(300);
    push(
      {},
      makeTape(
        "act",
        "INGEST",
        `Structured ${scenario.eventType} scenario — "${scenario.title}" · epicenter ${scenario.epicenterNode} · horizon ${scenario.horizonDays}d`,
        "Scenario Interpreter"
      )
    );
    await sleep(300);

    // ─── LIVE-TRANSPORT BASELINE (additive — only when provided) ───
    if (opts.transportBaseline) {
      const baseline = opts.transportBaseline;
      // Mirror the observed snapshot into Nexla and record the immutable baseline.
      await ingestTransportSnapshot(baseline);
      await recordTransportBaseline(baseline);
      nexlaCalls += 2;
      push(
        {
          transportBaseline: baseline,
          telemetry: { ...state.telemetry, nexlaToolCalls: nexlaCalls },
        },
        makeTape(
          "observe",
          "INGEST",
          `Baseline captured — ${baseline.vessels.length} vessels, ${baseline.aircraft.length} aircraft observed in ${baseline.regionId} (maritime ${baseline.providers.maritime.mode}, aviation ${baseline.providers.aviation.mode})`,
          "Logistics Agent",
          { snapshotId: baseline.id }
        )
      );
      await sleep(300);
    }

    // ─── MODEL ────────────────────────────────────────────
    setStage("MODEL");
    const statuses = deriveNetworkStatuses(merged, world);
    const affectedNodes = [...statuses.disrupted, ...statuses.tension];
    const affectedEdges = Object.entries(statuses.edgeStatuses)
      .filter(([, s]) => s !== "normal")
      .map(([id]) => id);
    const straitPct = Math.round(100 - shockProfile.ship);

    nexlaCalls += 1; // map_event_to_nodes on the Nexla-backed supply graph
    push(
      {
        affectedNodes,
        affectedEdges,
        nodeStatuses: statuses.nodeStatuses,
        edgeStatuses: statuses.edgeStatuses,
        businessPhase: PHASE.EVENT,
        telemetry: { ...state.telemetry, nexlaToolCalls: nexlaCalls },
      },
      makeTape(
        "act",
        "MODEL",
        `Found ${affectedNodes.length} exposed supply nodes (${statuses.disrupted.length} disrupted, ${statuses.tension.length} under tension)`,
        "Supply Graph Agent"
      )
    );
    await sleep(300);
    push(
      {},
      makeTape(
        "observe",
        "MODEL",
        `Reduced Taiwan Strait capacity to ${straitPct}% of normal outbound shipping`,
        "Logistics Agent"
      )
    );
    await sleep(250);
    push(
      {},
      makeTape(
        "observe",
        "MODEL",
        `Estimated critical depletion in ${bundle.operational.inventoryCoverageDays}d of channel inventory`,
        "Inventory Agent"
      )
    );
    await sleep(250);
    push(
      { businessPhase: PHASE.DEPLETION },
      makeTape(
        "observe",
        "MODEL",
        `Found alternative capacity in the US and Malaysia (${statuses.alternative.length} nodes still healthy)`,
        "Substitution Agent"
      )
    );
    await sleep(300);

    // ─── TRANSPORT EXPOSURE (phase 1: primary shock) ──────
    if (opts.transportBaseline) {
      const baseline = opts.transportBaseline;
      const primaryStatuses = deriveNetworkStatuses(scenario, world);
      await mapTransportAssetsToRoutes(baseline, primaryStatuses);
      nexlaCalls += 1;
      const t1 = computeTransportImpact(baseline, scenario, primaryStatuses, industry);
      push(
        {
          exposedTransportAssets: t1.exposedAssetIds,
          transportImpact: t1.impact,
          telemetry: { ...state.telemetry, nexlaToolCalls: nexlaCalls },
        },
        makeTape(
          "observe",
          "MODEL",
          `Observed ${t1.impact.observedVesselsInRegion} vessels in region, ${t1.impact.exposedVesselCount} potentially exposed; ${t1.impact.exposedAircraftCount} of ${t1.impact.observedAircraftInRegion} aircraft exposed`,
          "Logistics Agent",
          { exposed: t1.exposedAssetIds.length }
        )
      );
      await sleep(300);
    }

    // ─── SECONDARY-SHOCK CORRECTION ───────────────────────
    if (secondaryApplied && secondary) {
      push(
        { secondaryShockApplied: true },
        makeTape(
          "correct",
          "MODEL",
          "Initial model overstated Japanese replacement capacity — export limits on equipment & photoresist invalidate the mitigation plan. Merging secondary shock and recomputing.",
          "Risk Critic",
          { secondaryShockId: secondary.id }
        )
      );
      await sleep(350);

      // Recompute transport exposure under the merged (Japan) shock — worse, lower
      // confidence, Japan-facing aircraft added.
      if (opts.transportBaseline) {
        const baseline = opts.transportBaseline;
        const t2 = computeTransportImpact(baseline, merged, statuses, industry);
        const air2 = t2.impact.estimatedAirCapacityReductionPercent;
        push(
          {
            exposedTransportAssets: t2.exposedAssetIds,
            transportImpact: t2.impact,
          },
          makeTape(
            "correct",
            "MODEL",
            `Transport exposure re-scored under the Japan restriction — ${t2.impact.exposedAircraftCount} aircraft now exposed on the Japan-facing approach${
              air2 ? ` · air-freight −${air2.min}–${air2.max}%` : ""
            } · rerouting ~${t2.impact.medianReroutingDelayDays}d · confidence ${t2.impact.confidence}`,
            "Logistics Agent"
          )
        );
        await sleep(300);
      }
    }

    // ─── SIMULATE ─────────────────────────────────────────
    setStage("SIMULATE");
    push(
      { businessPhase: PHASE.PEAK },
      makeTape(
        "plan",
        "SIMULATE",
        secondaryApplied
          ? "Rerunning scenario with the Japan export restriction merged in…"
          : "Dispatching Monte-Carlo supply-shock propagation to the Akash sim worker…",
        "Simulation Orchestrator"
      )
    );
    await sleep(300);

    const sim = runScenarioSimulation({
      scenario,
      industry,
      worldModel: world,
      secondary,
    });

    push(
      {
        sim,
        operational: sim.operational,
        companies: sim.companies,
        financial: sim.financial,
        portfolio: bundle.portfolio,
        nodeStatuses: sim.nodeStatuses,
        edgeStatuses: sim.edgeStatuses,
        propagationOrder: sim.propagationOrder,
        propagationEvents: sim.propagationEvents,
        telemetry: {
          ...state.telemetry,
          akashLeaseId: sim.leaseId,
          akashProvider: sim.provider,
          akashEndpoint: sim.endpoint,
        },
      },
      makeTape(
        "observe",
        "SIMULATE",
        `Akash ${sim.source}: worker=${sim.worker} · lease=${sim.leaseId} · ${sim.nSims} sims · ${sim.elapsedMs}ms · supply −${sim.operational.supplyReductionPercent}% · shortage p=${sim.operational.shortageProbability}`,
        "Simulation Orchestrator",
        { lease: sim.leaseId }
      )
    );
    await sleep(300);

    // Fold the observed-transport aggregate into the SIMULATE narrative.
    if (state.transportImpact) {
      const ti = state.transportImpact;
      const air = ti.estimatedAirCapacityReductionPercent;
      push(
        {},
        makeTape(
          "observe",
          "SIMULATE",
          `Akash simulates logistics rerouting: median rerouting delay ~${
            ti.medianReroutingDelayDays ?? "n/a"
          }d${air ? ` · air-freight capacity reduction ${air.min}–${air.max}%` : ""} across ${
            ti.exposedVesselCount
          } exposed vessels / ${ti.exposedAircraftCount} exposed aircraft`,
          "Simulation Orchestrator"
        )
      );
      await sleep(250);
    }

    const nvda = sim.companies.find((c) => c.companyId === "NVDA");
    const intc = sim.companies.find((c) => c.companyId === "INTC");
    push(
      {},
      makeTape(
        "act",
        "SIMULATE",
        `Recomputed NVIDIA revenue exposure: $${fmtB(nvda?.revenueImpactMinUsd)}–$${fmtB(
          nvda?.revenueImpactMaxUsd
        )}B at risk · Intel now ${intc?.direction ?? "?"}`,
        "Financial Agent"
      )
    );

    await logSignal({
      market_id: "mkt-soxx-drawdown",
      side: "YES",
      ev: -sim.financial.estimatedMarketMoveMinPercent / 100,
      confidence: sim.confidence,
      thesis: `${scenario.title}: semiconductor index draws down ${sim.financial.estimatedMarketMoveMinPercent}–${sim.financial.estimatedMarketMoveMaxPercent}% over the horizon.`,
    });
    nexlaCalls += 1;
    await writeThesis({
      market_id: "mkt-soxx-drawdown",
      thesis: `ChainAlpha ${scenario.eventType}: revenue at risk $${fmtB(
        sim.financial.revenueAtRiskMinUsd
      )}–$${fmtB(sim.financial.revenueAtRiskMaxUsd)}B; hedge semi-index exposure.`,
    });
    nexlaCalls += 1;
    push({ telemetry: { ...state.telemetry, nexlaToolCalls: nexlaCalls } });
    await sleep(350);

    // ─── RISK ─────────────────────────────────────────────
    setStage("RISK");
    const proposals = bundle.proposals;
    const initial = { ...proposals.initial };
    const primaryRevised = { ...proposals.primaryRevised };
    const secondaryRevised = proposals.secondaryRevised
      ? { ...proposals.secondaryRevised }
      : undefined;
    const approvedProposal = secondaryRevised ?? primaryRevised;

    push(
      {
        attemptedSize: initial.notionalUsd ?? null,
        proposals: [initial],
        businessPhase: PHASE.SHORTAGE,
        clearance: "TRADER",
      },
      makeTape(
        "act",
        "RISK",
        `Proposing aggressive rotation: reduce NVDA ${pct(initial, "NVDA")}, increase INTC ${pct(
          initial,
          "INTC"
        )}, hedge SOXX ${pct(initial, "SOXX")} · notional $${initial.notionalUsd?.toFixed(
          2
        )} · maxDD ${initial.maxDrawdownPercent}% — routing execute_trade through Pomerium…`,
        "Trading Agent"
      )
    );
    await sleep(400);

    const denial = await gateExecuteTrade({
      market_id: "mkt-soxx-drawdown",
      side: "YES",
      size_usd: initial.notionalUsd ?? 5.0,
      price: 0.5,
    });
    pomDeny += 1;
    initial.status = "blocked";
    push(
      {
        clearance: "DENIED",
        lastDenial: `ACCESS DENIED — POMERIUM: ${denial.decision.reason}`,
        proposals: [initial],
        positions: (await getPositions()).data,
        telemetry: { ...state.telemetry, pomeriumDeny: pomDeny, pomeriumAllow: pomAllow },
      },
      makeTape(
        "observe",
        "RISK",
        `ACCESS DENIED — POMERIUM: ${denial.decision.reason} · notional $${(
          initial.notionalUsd ?? 5
        ).toFixed(2)} > max $${MAX_STAKE_USD.toFixed(2)} (violated ${initial.violatedLimit})`,
        "Trading Agent",
        { decision: denial.decision }
      )
    );
    await sleep(500);

    push(
      {},
      makeTape(
        "correct",
        "RISK",
        "Revising portfolio exposure: resize within the stake limit and cap drawdown.",
        "Risk Critic"
      )
    );
    await sleep(300);

    const allow1 = await gateExecuteTrade({
      market_id: "mkt-soxx-drawdown",
      side: "YES",
      size_usd: primaryRevised.notionalUsd ?? 1.5,
      price: 0.5,
    });
    if (!allow1.decision.allowed) throw new Error("Unexpected deny on resized trade");
    pomAllow += 1;
    primaryRevised.status = "approved";
    push(
      {
        clearance: "TRADER",
        lastDenial: null,
        approvedSize: primaryRevised.notionalUsd ?? 1.5,
        proposals: [initial, primaryRevised],
        telemetry: { ...state.telemetry, pomeriumAllow: pomAllow, pomeriumDeny: pomDeny },
      },
      makeTape(
        "observe",
        "RISK",
        `POMERIUM ALLOW · identity=risk-approved · notional $${(
          primaryRevised.notionalUsd ?? 1.5
        ).toFixed(2)} · maxDD ${primaryRevised.maxDrawdownPercent}%`,
        "Trading Agent",
        { decision: allow1.decision }
      )
    );
    await sleep(300);

    if (secondaryRevised) {
      push(
        {},
        makeTape(
          "correct",
          "RISK",
          "Intel is now negative under the Japan restriction — cutting the Intel add and leaning harder on the SOXX hedge.",
          "Risk Critic"
        )
      );
      await sleep(300);
      const allow2 = await gateExecuteTrade({
        market_id: "mkt-soxx-drawdown",
        side: "YES",
        size_usd: secondaryRevised.notionalUsd ?? 1.5,
        price: 0.5,
      });
      if (!allow2.decision.allowed) throw new Error("Unexpected deny on secondary revision");
      pomAllow += 1;
      secondaryRevised.status = "approved";
      push(
        {
          proposals: [initial, primaryRevised, secondaryRevised],
          telemetry: { ...state.telemetry, pomeriumAllow: pomAllow, pomeriumDeny: pomDeny },
        },
        makeTape(
          "observe",
          "RISK",
          `POMERIUM ALLOW (revised) · notional $${(secondaryRevised.notionalUsd ?? 1.5).toFixed(
            2
          )} · maxDD ${secondaryRevised.maxDrawdownPercent}%`,
          "Trading Agent",
          { decision: allow2.decision }
        )
      );
      await sleep(300);
    }

    // ─── EXECUTE ──────────────────────────────────────────
    setStage("EXECUTE");
    const notional = approvedProposal.notionalUsd ?? 1.5;
    push(
      {},
      makeTape(
        "act",
        "EXECUTE",
        `Placing PAPER hedge — $${notional.toFixed(
          2
        )} notional on the semi-index drawdown via Zero execution (modelled, no guaranteed return)…`,
        "Trading Agent"
      )
    );
    await sleep(400);

    const fill = await executeViaZero({
      market_id: "mkt-soxx-drawdown",
      side: "YES",
      size_usd: notional,
      price: 0.5,
    });
    const walletExec = getZeroWallet();
    await recordFill({
      market_id: fill.market_id,
      side: fill.side,
      size_usd: fill.size_usd,
      price: fill.price,
      zero_tx: fill.tx,
    });
    nexlaCalls += 1;
    approvedProposal.status = "executed";

    const finalProposals = secondaryRevised
      ? [initial, primaryRevised, secondaryRevised]
      : [initial, primaryRevised];

    push(
      {
        proposals: [...finalProposals],
        positions: (await getPositions()).data,
        telemetry: {
          ...state.telemetry,
          zeroSpendUsd: walletExec.spend,
          zeroWalletUsd: walletExec.balance,
          nexlaToolCalls: nexlaCalls,
          capabilitiesDiscovered: getDiscoveredCapabilities().map((c) => c.name),
          pomeriumAllow: pomAllow,
          pomeriumDeny: pomDeny,
        },
      },
      makeTape(
        "observe",
        "EXECUTE",
        `FILL ${fill.tx} · $${fill.size_usd.toFixed(2)} @ ${fill.price.toFixed(
          2
        )} · wallet $${walletExec.balance.toFixed(2)} (${fill.source})`,
        "Trading Agent"
      )
    );
    await sleep(350);

    // ─── SETTLE ───────────────────────────────────────────
    setStage("SETTLE");
    const pnlUsd = Math.round(approvedProposal.expectedPnlUsd * 0.55);
    push(
      { businessPhase: PHASE.RECOVERY, pnlUsd },
      makeTape(
        "observe",
        "SETTLE",
        `Position book updated via Nexla · portfolio re-marked to scenario direction · modelled P&L $${pnlUsd.toLocaleString()} · recovery ${sim.operational.recoveryMinDays}–${sim.operational.recoveryMaxDays}d`,
        "Simulation Orchestrator"
      )
    );
    await sleep(300);

    push(
      { businessPhase: PHASE.POST },
      makeTape(
        "system",
        "SETTLE",
        "ChainAlpha turned a physical-world semiconductor disruption into a modelled, risk-gated, tradable exposure — no human placed the trade.",
        "system"
      )
    );

    setStage("DONE");
    emit({ type: "done", payload: state });
    return state;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStage("ERROR");
    push({}, makeTape("system", "ERROR", `Pipeline error: ${message}`, "system"));
    emit({ type: "error", payload: message });
    return state;
  }
}

// ─── small formatting helpers (deterministic) ──────────────

function fmtB(n?: number): string {
  if (!n) return "0.0";
  return (n / 1_000_000_000).toFixed(2);
}

function pct(proposal: { actions: { asset: string; positionChangePercent: number }[] }, asset: string): string {
  const a = proposal.actions.find((x) => x.asset === asset);
  if (!a) return "0%";
  const v = a.positionChangePercent;
  return `${v > 0 ? "+" : ""}${v}%`;
}
