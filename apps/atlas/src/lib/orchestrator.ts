/**
 * ATLAS CAPITAL orchestrator — multi-phase:
 * SCENARIO/SCREEN → (await outcomes) → MODEL/SIMULATE/PROPOSE → (await approval) → RISK/EXECUTE/SETTLE
 */

import { runSimulation } from "./adapters/akash";
import {
  getPositions,
  getWorldModel,
  logSignal,
  mapEventToNodes,
  recordFill,
  writeThesis,
} from "./adapters/nexla";
import {
  clearRiskAuditLog,
  gateExecuteTrade,
  gateReadTool,
  MAX_STAKE_USD,
} from "./adapters/pomerium";
import {
  executeViaZero,
  getDiscoveredCapabilities,
  getZeroWallet,
  ingestViaZero,
  resetZeroWallet,
} from "./adapters/zero";
import { loadOutcomes, matchScenario } from "./scenario";
import {
  emptyFundState,
  getSession,
  nowIso,
  resetPositionBook,
  saveSession,
  sleep,
  uid,
  updateSession,
} from "./store";
import { buildSimTimeline } from "./timeline";
import type {
  AffectedOutcome,
  FundState,
  OrchestratorEvent,
  PipelineStage,
  ScenarioMatch,
  TapeEvent,
  Telemetry,
  TradeProposal,
} from "./types";

export type EmitFn = (event: OrchestratorEvent) => void;

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
    sources: {
      zero: "—",
      nexla: "—",
      pomerium: "—",
      akash: "—",
    },
  };
}

function makeTape(
  kind: TapeEvent["kind"],
  stage: PipelineStage,
  message: string,
  meta?: Record<string, unknown>
): TapeEvent {
  return {
    id: uid("tape"),
    ts: nowIso(),
    kind,
    stage,
    message,
    meta,
  };
}

export function createInitialState(mode: "live" | "replay"): FundState {
  return {
    ...emptyFundState(mode),
    telemetry: initialTelemetry(),
  };
}

type Mutable = {
  state: FundState;
  nexlaCalls: number;
  pomAllow: number;
  pomDeny: number;
};

function makeHelpers(emit: EmitFn, ctx: Mutable) {
  const push = (partial: Partial<FundState>, tape?: TapeEvent) => {
    if (tape) {
      ctx.state = { ...ctx.state, ...partial, tape: [...ctx.state.tape, tape] };
      emit({ type: "tape", payload: tape });
    } else {
      ctx.state = { ...ctx.state, ...partial };
    }
    emit({ type: "state", payload: ctx.state });
  };

  const setStage = (stage: PipelineStage) => {
    push({ stage });
    emit({ type: "stage", payload: stage });
  };

  return { push, setStage };
}

/** Phase 1: screen a scenario (text or preset) */
export async function runScreen(
  emit: EmitFn,
  opts: { text?: string; preset_id?: string; replay?: boolean }
): Promise<FundState> {
  const mode = opts.replay ? "replay" : "live";
  resetPositionBook();
  resetZeroWallet(5);
  clearRiskAuditLog();

  const ctx: Mutable = {
    state: createInitialState(mode),
    nexlaCalls: 0,
    pomAllow: 0,
    pomDeny: 0,
  };
  const { push, setStage } = makeHelpers(emit, ctx);

  try {
    setStage("SCENARIO");
    push(
      {},
      makeTape(
        "plan",
        "SCENARIO",
        opts.preset_id
          ? `Loading preset scenario ${opts.preset_id}…`
          : `Parsing scenario: "${(opts.text ?? "").slice(0, 80)}"`
      )
    );
    await sleep(280);

    // Zero enrichment — sole odds/news path (live when ZERO_* set, else fixture)
    const ingest = await ingestViaZero({ replay: Boolean(opts.replay) });
    const wallet = getZeroWallet();
    push(
      {
        telemetry: {
          ...ctx.state.telemetry,
          zeroSpendUsd: wallet.spend,
          zeroWalletUsd: wallet.balance,
          capabilitiesDiscovered: getDiscoveredCapabilities().map((c) => c.name),
          sources: { ...ctx.state.telemetry.sources, zero: ingest.source },
        },
      },
      makeTape(
        "observe",
        "SCENARIO",
        `Zero enrichment (${ingest.source}) · ${ingest.capabilities.map((c) => c.name).join(", ")} · spend $${ingest.spendUsd.toFixed(2)}`,
        { actor: "Zero", source: ingest.source }
      )
    );
    await sleep(250);

    const matched: ScenarioMatch = opts.replay
      ? matchScenario({ preset_id: "hormuz-closure" })
      : matchScenario({
          text: opts.text,
          preset_id: opts.preset_id,
        });

    // Only merge Zero fixture headlines when geography matches (avoid Red Sea→Hormuz mashup)
    const geoMatch =
      ingest.source === "zero-live" ||
      ingest.event.epicenter_node === matched.event.epicenter_node;
    matched.event = {
      ...matched.event,
      source: `${matched.event.source}+zero`,
      news_headlines: geoMatch
        ? [
            ...matched.event.news_headlines,
            ...ingest.event.news_headlines.slice(0, 1),
          ].slice(0, 4)
        : matched.event.news_headlines,
    };
    if (!geoMatch && ingest.source === "zero-fixture") {
      push(
        {},
        makeTape(
          "system",
          "SCENARIO",
          `Zero fixture geography (${ingest.event.epicenter_node}) ≠ epicenter — skipped headline merge`,
          { actor: "Zero", source: ingest.source }
        )
      );
    }

    setStage("SCREEN");
    push(
      {},
      makeTape(
        "act",
        "SCREEN",
        `Epicenter ${matched.epicenter_nodes.join(", ")} · ${matched.disruption_type} · severity ${matched.severity.toFixed(2)}`
      )
    );
    await sleep(300);

    const signal = await logSignal({
      market_id: matched.event.markets[0]?.id ?? "screen",
      side: "YES",
      ev: matched.implied_probability,
      confidence: matched.severity,
      thesis: `SCREEN: ${matched.event.title}`,
    });
    ctx.nexlaCalls += 1;
    // Pomerium allows read/research tools for trader-agent
    const screenGate = gateReadTool("log_signal");
    push(
      {
        telemetry: {
          ...ctx.state.telemetry,
          nexlaToolCalls: ctx.nexlaCalls,
          sources: {
            ...ctx.state.telemetry.sources,
            nexla: signal.source,
            pomerium: screenGate.source,
          },
        },
      },
      makeTape(
        "act",
        "SCREEN",
        `Nexla log_signal (${signal.source}) · Pomerium ${screenGate.decision} (${screenGate.source})`,
        { actor: "Nexla", source: signal.source, pomerium: screenGate.source }
      )
    );

    const outcomes = matched.affected_outcomes;
    push(
      {
        scenario: matched,
        event: matched.event,
        affectedOutcomes: outcomes,
        selectedOutcomes: [],
        telemetry: {
          ...ctx.state.telemetry,
          nexlaToolCalls: ctx.nexlaCalls,
          zeroSpendUsd: getZeroWallet().spend,
          zeroWalletUsd: getZeroWallet().balance,
          capabilitiesDiscovered: getDiscoveredCapabilities().map((c) => c.name),
          sources: {
            ...ctx.state.telemetry.sources,
            pomerium: screenGate.source,
          },
        },
        positions: (await getPositions()).data,
      },
      makeTape(
        "observe",
        "SCREEN",
        `Affected outcomes: ${outcomes.map((o) => o.name).join(", ") || "none"}`
      )
    );
    await sleep(200);

    setStage("AWAITING_OUTCOMES");
    push(
      {},
      makeTape(
        "system",
        "AWAITING_OUTCOMES",
        "Select the outcomes you care about, then run the simulation."
      )
    );

    saveSession(matched.scenario_id, {
      scenario: matched,
      selectedOutcomes: [],
      state: ctx.state,
    });

    emit({ type: "done", payload: ctx.state });
    return ctx.state;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStage("ERROR");
    push({}, makeTape("system", "ERROR", `Screen error: ${message}`));
    emit({ type: "error", payload: message });
    return ctx.state;
  }
}

/** Phase 2: simulate conditioned on selected outcomes → proposals */
export async function runSimulatePhase(
  emit: EmitFn,
  opts: { scenario_id: string; outcomes: string[]; replay?: boolean }
): Promise<FundState> {
  const session = getSession(opts.scenario_id);
  if (!session) {
    emit({ type: "error", payload: "Unknown scenario_id — run screen first" });
    throw new Error("Unknown scenario_id");
  }

  const matched = session.scenario;
  const selected = opts.outcomes.length
    ? opts.outcomes
    : matched.affected_outcomes.map((o) => o.id);

  const ctx: Mutable = {
    state: {
      ...session.state,
      selectedOutcomes: selected,
      tape: [...session.state.tape],
      mode: opts.replay ? "replay" : session.state.mode,
    },
    nexlaCalls: session.state.telemetry.nexlaToolCalls,
    pomAllow: session.state.telemetry.pomeriumAllow,
    pomDeny: session.state.telemetry.pomeriumDeny,
  };
  const { push, setStage } = makeHelpers(emit, ctx);

  try {
    setStage("MODEL");
    push(
      { selectedOutcomes: selected, viewport: "globe" },
      makeTape(
        "plan",
        "MODEL",
        `Mapping disruption onto world model for outcomes: ${selected.join(", ")}`
      )
    );
    await sleep(300);

    // Pomerium gates Nexla research tools before mapping
    const mapGate = gateReadTool("map_event_to_nodes");
    const mapped = await mapEventToNodes({
      epicenter_node: matched.event.epicenter_node,
      implied_probability: matched.implied_probability,
      max_hops: 4,
    });
    ctx.nexlaCalls += 1;

    // World model via Nexla adapter (live MCP or local Nexset)
    const wmResult = await getWorldModel();
    ctx.nexlaCalls += 1;
    const wm = wmResult.data;

    // Filter edges by selected outcome commodities / lane types
    const { outcomes: taxonomy } = loadOutcomes();
    const selectedDefs = taxonomy.filter((o) => selected.includes(o.id));
    const wantedCommodities = new Set(
      selectedDefs.flatMap((o) => o.commodities)
    );
    const wantedLanes = new Set(selectedDefs.flatMap((o) => o.lane_types));

    const disruptedEdges = wm.edges
      .filter((e) => {
        const c = e.commodity ?? "";
        const lt = e.lane_type ?? "sea";
        return (
          (wantedCommodities.has(c) || wantedLanes.has(lt)) &&
          (mapped.data.edgeIds.includes(e.id) ||
            e.from === matched.event.epicenter_node ||
            e.to === matched.event.epicenter_node)
        );
      })
      .map((e) => e.id);

    push(
      {
        affectedNodes: mapped.data.nodeIds,
        affectedEdges: mapped.data.edgeIds,
        disruptedEdges,
        telemetry: {
          ...ctx.state.telemetry,
          nexlaToolCalls: ctx.nexlaCalls,
          sources: {
            ...ctx.state.telemetry.sources,
            nexla: mapped.source,
            pomerium: mapGate.source,
          },
        },
      },
      makeTape(
        "act",
        "MODEL",
        `Nexla map (${mapped.source}) · Pomerium ${mapGate.decision} · ${mapped.data.nodeIds.length} nodes · ${disruptedEdges.length} disrupted edges`,
        { actor: "Nexla", source: mapped.source, pomerium: mapGate.source }
      )
    );
    await sleep(350);

    setStage("SIMULATE");
    // Keep globe until timeline `tactical_cutaway` — avoid pre-playback map flash
    push(
      { viewport: "globe" },
      makeTape(
        "plan",
        "SIMULATE",
        "Dispatching conditioned Monte Carlo to Akash sim worker…"
      )
    );
    await sleep(250);

    const { result: simRaw, lease } = await runSimulation(matched.event, {
      outcome_filter: selected,
      disruption: {
        nodes: matched.epicenter_nodes,
        type: matched.disruption_type,
        severity: matched.severity,
      },
    });

    const timeline = buildSimTimeline({
      sim: simRaw,
      worldModel: wm,
      scenario: matched,
      disruptedEdges,
      selectedOutcomes: selected,
      short: Boolean(opts.replay),
    });
    const sim = { ...simRaw, timeline };

    push(
      {
        sim,
        viewport: "globe",
        telemetry: {
          ...ctx.state.telemetry,
          akashLeaseId: lease.lease_id,
          akashProvider: lease.provider,
          akashEndpoint: lease.endpoint,
          nexlaToolCalls: ctx.nexlaCalls,
          sources: {
            ...ctx.state.telemetry.sources,
            akash: lease.source,
            nexla: wmResult.source,
          },
        },
      },
      makeTape(
        "observe",
        "SIMULATE",
        `Akash ${lease.source}: ${sim.n_sims} sims · ${sim.elapsed_ms}ms · vessels=${sim.vessel_count ?? "—"} · playback ${Math.round(timeline.duration_ms / 1000)}s`,
        { actor: "Akash", source: lease.source }
      )
    );
    await sleep(200);

    // Filter markets by selected outcomes
    const allowedMarkets = new Set(selectedDefs.flatMap((o) => o.markets));
    let markets = sim.markets.filter(
      (m) => allowedMarkets.size === 0 || allowedMarkets.has(m.market_id)
    );
    if (markets.length === 0) markets = sim.markets.slice(0, 3);

    setStage("PROPOSE");
    const proposals: TradeProposal[] = markets.slice(0, 4).map((m, i) => ({
      id: uid("prop"),
      market_id: m.market_id,
      question: m.question,
      side: m.side,
      ev: m.expected_value,
      confidence: m.confidence,
      size_usd: i === 0 ? 1.5 : Math.max(0.5, Number((1.2 - i * 0.2).toFixed(2))),
      price: m.market_price ?? 0.5,
      rationale: `Simulated ${matched.disruption_type} at ${matched.event.epicenter_node} → edge ${(m.edge ?? 0).toFixed(3)} on selected outcomes`,
    }));

    for (const p of proposals) {
      await logSignal({
        market_id: p.market_id,
        side: p.side,
        ev: p.ev,
        confidence: p.confidence,
        thesis: p.rationale,
      });
      ctx.nexlaCalls += 1;
    }
    await writeThesis({
      market_id: proposals[0]?.market_id,
      thesis: `ATLAS proposals for ${matched.event.title}`,
    });
    ctx.nexlaCalls += 1;

    push(
      {
        proposals,
        selectedMarket: markets[0] ?? null,
        sim: { ...sim, markets },
        positions: (await getPositions()).data,
        telemetry: { ...ctx.state.telemetry, nexlaToolCalls: ctx.nexlaCalls },
      },
      makeTape(
        "act",
        "PROPOSE",
        `Agent proposes ${proposals.length} trades — select which to execute`
      )
    );

    setStage("AWAITING_APPROVAL");
    push(
      {},
      makeTape(
        "system",
        "AWAITING_APPROVAL",
        "Approve trades to let the agent execute autonomously through Pomerium → Zero → Nexla."
      )
    );

    emit({ type: "proposals", payload: proposals });
    updateSession(opts.scenario_id, {
      selectedOutcomes: selected,
      state: ctx.state,
    });
    emit({ type: "done", payload: ctx.state });
    return ctx.state;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStage("ERROR");
    push({}, makeTape("system", "ERROR", `Simulate error: ${message}`));
    emit({ type: "error", payload: message });
    return ctx.state;
  }
}

/** Phase 3: execute approved proposals */
export async function runExecutePhase(
  emit: EmitFn,
  opts: { scenario_id: string; proposal_ids: string[] }
): Promise<FundState> {
  const session = getSession(opts.scenario_id);
  if (!session) {
    emit({ type: "error", payload: "Unknown scenario_id" });
    throw new Error("Unknown scenario_id");
  }

  const proposals = session.state.proposals.filter((p) =>
    opts.proposal_ids.includes(p.id)
  );
  if (!proposals.length) {
    emit({ type: "error", payload: "No proposals selected" });
    throw new Error("No proposals selected");
  }

  const ctx: Mutable = {
    state: { ...session.state, tape: [...session.state.tape] },
    nexlaCalls: session.state.telemetry.nexlaToolCalls,
    pomAllow: session.state.telemetry.pomeriumAllow,
    pomDeny: session.state.telemetry.pomeriumDeny,
  };
  const { push, setStage } = makeHelpers(emit, ctx);

  try {
    let first = true;
    for (const prop of proposals) {
      setStage("RISK");
      if (first) {
        // Policy-driven deny: stake above Pomerium max (mirrors pomerium/config.yaml)
        const oversized = Number((MAX_STAKE_USD + 3).toFixed(2));
        push(
          { attemptedSize: oversized, clearance: "TRADER", selectedMarket: {
            market_id: prop.market_id,
            question: prop.question,
            side: prop.side,
            mean_impact: 0,
            p5: 0,
            p95: 0,
            expected_value: prop.ev,
            confidence: prop.confidence,
            market_price: prop.price,
            edge: prop.ev,
          } },
          makeTape(
            "act",
            "RISK",
            `Sizing $${oversized.toFixed(2)} on ${prop.market_id} — Pomerium max $${MAX_STAKE_USD.toFixed(2)}…`
          )
        );
        await sleep(400);
        const denial = await gateExecuteTrade({
          market_id: prop.market_id,
          side: prop.side,
          size_usd: oversized,
          price: prop.price,
        });
        ctx.pomDeny += 1;
        push(
          {
            clearance: "DENIED",
            lastDenial: `ACCESS DENIED — POMERIUM: ${denial.decision.reason}`,
            positions: (await getPositions()).data,
            telemetry: {
              ...ctx.state.telemetry,
              pomeriumDeny: ctx.pomDeny,
              pomeriumAllow: ctx.pomAllow,
              sources: {
                ...ctx.state.telemetry.sources,
                pomerium: denial.decision.source,
              },
            },
          },
          makeTape(
            "observe",
            "RISK",
            `ACCESS DENIED — POMERIUM (${denial.decision.source}): ${denial.decision.reason}`,
            { actor: "Pomerium", source: denial.decision.source }
          )
        );
        await sleep(450);
        push(
          {
            approvedSize: prop.size_usd,
            clearance: "TRADER",
            lastDenial: null,
          },
          makeTape(
            "correct",
            "RISK",
            `Self-correct: resize $${oversized.toFixed(2)} → $${prop.size_usd.toFixed(2)}`
          )
        );
        await sleep(300);
        first = false;
      } else {
        push(
          { attemptedSize: prop.size_usd, approvedSize: prop.size_usd },
          makeTape(
            "act",
            "RISK",
            `Routing $${prop.size_usd.toFixed(2)} ${prop.market_id} through Pomerium…`
          )
        );
        await sleep(250);
      }

      const allow = await gateExecuteTrade({
        market_id: prop.market_id,
        side: prop.side,
        size_usd: prop.size_usd,
        price: prop.price,
      });
      if (!allow.decision.allowed) {
        throw new Error(`Denied: ${allow.decision.reason}`);
      }
      ctx.pomAllow += 1;
      push(
        {
          telemetry: {
            ...ctx.state.telemetry,
            pomeriumAllow: ctx.pomAllow,
            pomeriumDeny: ctx.pomDeny,
            sources: {
              ...ctx.state.telemetry.sources,
              pomerium: allow.decision.source,
            },
          },
        },
        makeTape(
          "observe",
          "RISK",
          `POMERIUM ALLOW (${allow.decision.source}) · $${prop.size_usd.toFixed(2)} ${prop.market_id}`,
          { actor: "Pomerium", source: allow.decision.source }
        )
      );
      await sleep(250);

      setStage("EXECUTE");
      push(
        {},
        makeTape(
          "act",
          "EXECUTE",
          `Placing $${prop.size_usd.toFixed(2)} via Zero wallet…`
        )
      );
      await sleep(350);

      const fill = await executeViaZero({
        market_id: prop.market_id,
        side: prop.side,
        size_usd: prop.size_usd,
        price: prop.price,
      });
      await recordFill({
        market_id: fill.market_id,
        side: fill.side,
        size_usd: fill.size_usd,
        price: fill.price,
        zero_tx: fill.tx,
      });
      ctx.nexlaCalls += 1;
      const walletAfter = getZeroWallet();
      push(
        {
          positions: (await getPositions()).data,
          telemetry: {
            ...ctx.state.telemetry,
            zeroSpendUsd: walletAfter.spend,
            zeroWalletUsd: walletAfter.balance,
            nexlaToolCalls: ctx.nexlaCalls,
            pomeriumAllow: ctx.pomAllow,
            pomeriumDeny: ctx.pomDeny,
            capabilitiesDiscovered: getDiscoveredCapabilities().map((c) => c.name),
            sources: {
              ...ctx.state.telemetry.sources,
              zero: fill.source,
              pomerium: allow.decision.source,
            },
          },
        },
        makeTape(
          "observe",
          "EXECUTE",
          `FILL ${fill.tx} (${fill.source}) · $${fill.size_usd.toFixed(2)} @ ${fill.price.toFixed(2)}`,
          { actor: "Zero", source: fill.source }
        )
      );
      await sleep(300);
    }

    setStage("SETTLE");
    push(
      {},
      makeTape(
        "observe",
        "SETTLE",
        `Settled ${proposals.length} fills via Nexla position book`
      )
    );
    await sleep(250);
    push(
      {},
      makeTape(
        "system",
        "SETTLE",
        "No human placed a trade. ATLAS executed only what you approved."
      )
    );
    setStage("DONE");
    updateSession(opts.scenario_id, { state: ctx.state });
    emit({ type: "done", payload: ctx.state });
    return ctx.state;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStage("ERROR");
    push({}, makeTape("system", "ERROR", `Execute error: ${message}`));
    emit({ type: "error", payload: message });
    return ctx.state;
  }
}

/** Legacy one-press pipeline (replay demo) */
export async function runPipeline(
  emit: EmitFn,
  opts: { replay?: boolean } = {}
): Promise<FundState> {
  const replay = opts.replay ?? true;
  const screenState = await runScreen(emit, {
    preset_id: "hormuz-closure",
    replay,
  });
  const scenario_id = screenState.scenario?.scenario_id;
  if (!scenario_id) {
    emit({ type: "pipeline_done", payload: screenState });
    return screenState;
  }

  const outcomes =
    screenState.affectedOutcomes.map((o: AffectedOutcome) => o.id);
  const simState = await runSimulatePhase(emit, {
    scenario_id,
    outcomes,
    replay,
  });
  const ids = simState.proposals.map((p) => p.id);
  const finalState = await runExecutePhase(emit, {
    scenario_id,
    proposal_ids: ids,
  });
  // Single terminal event so clients don't close on intermediate phase `done`
  emit({ type: "pipeline_done", payload: finalState });
  return finalState;
}
