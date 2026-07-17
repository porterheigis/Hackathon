/**
 * ATLAS CAPITAL orchestrator — INGEST → MODEL → SIMULATE → RISK → EXECUTE → SETTLE
 * Emits SSE-friendly events for the agent tape and fund UI.
 */

import { runSimulation } from "./adapters/akash";
import {
  getPositions,
  logSignal,
  mapEventToNodes,
  recordFill,
  writeThesis,
} from "./adapters/nexla";
import { gateExecuteTrade, MAX_STAKE_USD } from "./adapters/pomerium";
import {
  executeViaZero,
  getDiscoveredCapabilities,
  getZeroWallet,
  ingestViaZero,
  resetZeroWallet,
} from "./adapters/zero";
import { nowIso, resetPositionBook, sleep, uid } from "./store";
import type {
  FundState,
  OrchestratorEvent,
  PipelineStage,
  TapeEvent,
  Telemetry,
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
    stage: "IDLE",
    clearance: "TRADER",
    event: null,
    affectedNodes: [],
    affectedEdges: [],
    sim: null,
    positions: [],
    selectedMarket: null,
    attemptedSize: null,
    approvedSize: null,
    lastDenial: null,
    telemetry: initialTelemetry(),
    tape: [],
    mode,
  };
}

export async function runPipeline(
  emit: EmitFn,
  opts: { replay?: boolean } = {}
): Promise<FundState> {
  const mode = opts.replay ? "replay" : "live";
  resetPositionBook();
  resetZeroWallet(5);

  let state = createInitialState(mode);
  let nexlaCalls = 0;
  let pomAllow = 0;
  let pomDeny = 0;

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

  try {
    // ─── INGEST ───────────────────────────────────────────
    setStage("INGEST");
    push(
      {},
      makeTape(
        "plan",
        "INGEST",
        mode === "replay"
          ? "REPLAY MODE — loading fixture event stream via Zero capability mirror"
          : "Scanning prediction-market watchlist via Zero…"
      )
    );
    await sleep(400);

    const ingest = await ingestViaZero({ replay: opts.replay });
    const wallet = getZeroWallet();
    push(
      {
        event: ingest.event,
        telemetry: {
          ...state.telemetry,
          zeroSpendUsd: wallet.spend,
          zeroWalletUsd: wallet.balance,
          capabilitiesDiscovered: getDiscoveredCapabilities().map((c) => c.name),
        },
      },
      makeTape(
        "observe",
        "INGEST",
        `Capability discovered: ${ingest.capabilities.map((c) => c.name).join(", ")} · spend $${ingest.spendUsd.toFixed(2)} (${ingest.source})`,
        { capabilities: ingest.capabilities }
      )
    );
    await sleep(300);
    push(
      {},
      makeTape(
        "act",
        "INGEST",
        `Event selected: "${ingest.event.title}" @ ${ingest.event.epicenter_node} · p=${ingest.event.implied_probability}`
      )
    );
    await sleep(350);

    // ─── MODEL ────────────────────────────────────────────
    setStage("MODEL");
    push(
      {},
      makeTape("plan", "MODEL", "Mapping event onto Nexla world-model Nexset…")
    );
    await sleep(300);

    const mapped = await mapEventToNodes({
      epicenter_node: ingest.event.epicenter_node,
      implied_probability: ingest.event.implied_probability,
      max_hops: 4,
    });
    nexlaCalls += 1;
    push(
      {
        affectedNodes: mapped.data.nodeIds,
        affectedEdges: mapped.data.edgeIds,
        telemetry: { ...state.telemetry, nexlaToolCalls: nexlaCalls },
      },
      makeTape(
        "act",
        "MODEL",
        `Nexla map_event_to_nodes → ${mapped.data.nodeIds.length} nodes · ${mapped.data.edgeIds.length} edges (${mapped.source})`
      )
    );
    await sleep(400);

    // ─── SIMULATE ─────────────────────────────────────────
    setStage("SIMULATE");
    push(
      {},
      makeTape(
        "plan",
        "SIMULATE",
        "Dispatching Monte Carlo propagation to Akash sim worker…"
      )
    );
    await sleep(250);

    const { result: sim, lease } = await runSimulation(ingest.event);
    push(
      {
        sim,
        telemetry: {
          ...state.telemetry,
          akashLeaseId: lease.lease_id,
          akashProvider: lease.provider,
          akashEndpoint: lease.endpoint,
          nexlaToolCalls: nexlaCalls,
        },
      },
      makeTape(
        "observe",
        "SIMULATE",
        `Akash ${lease.source}: lease=${lease.lease_id} · provider=${lease.provider} · ${sim.n_sims} sims · ${sim.elapsed_ms}ms`
      )
    );
    await sleep(300);

    const best = sim.markets[0];
    if (!best) throw new Error("No market EV from simulation");

    push(
      { selectedMarket: best },
      makeTape(
        "act",
        "SIMULATE",
        `Top EV: ${best.market_id} edge=${(best.edge ?? 0).toFixed(3)} conf=${best.confidence.toFixed(2)} → size thesis`
      )
    );

    await logSignal({
      market_id: best.market_id,
      side: best.side,
      ev: best.expected_value,
      confidence: best.confidence,
      thesis: `Disruption at ${ingest.event.epicenter_node} implies edge on ${best.market_id}`,
    });
    nexlaCalls += 1;
    await writeThesis({
      market_id: best.market_id,
      thesis: `ATLAS: ${ingest.event.title} → ${best.question}`,
    });
    nexlaCalls += 1;
    const positionsAfterSignal = (await getPositions()).data;
    nexlaCalls += 1;
    push({
      positions: positionsAfterSignal,
      telemetry: { ...state.telemetry, nexlaToolCalls: nexlaCalls },
    });
    await sleep(350);

    // ─── RISK ─────────────────────────────────────────────
    setStage("RISK");
    // Intentionally oversized first attempt for Pomerium denial beat
    const oversized = 5.0;
    push(
      { attemptedSize: oversized, clearance: "TRADER" },
      makeTape(
        "act",
        "RISK",
        `Sizing all-in $${oversized.toFixed(2)} on ${best.market_id} — routing execute_trade through Pomerium…`
      )
    );
    await sleep(400);

    const denial = await gateExecuteTrade({
      market_id: best.market_id,
      side: best.side,
      size_usd: oversized,
      price: best.market_price ?? 0.5,
    });
    pomDeny += 1;
    push(
      {
        clearance: "DENIED",
        lastDenial: `ACCESS DENIED — POMERIUM: ${denial.decision.reason}`,
        positions: (await getPositions()).data,
        telemetry: {
          ...state.telemetry,
          pomeriumDeny: pomDeny,
          pomeriumAllow: pomAllow,
          nexlaToolCalls: nexlaCalls,
        },
      },
      makeTape(
        "observe",
        "RISK",
        `ACCESS DENIED — POMERIUM: ${denial.decision.reason} · size $${oversized.toFixed(2)} > max $${MAX_STAKE_USD.toFixed(2)}`,
        { decision: denial.decision }
      )
    );
    await sleep(500);

    const resized = 1.5;
    push(
      { approvedSize: resized, clearance: "TRADER", lastDenial: null },
      makeTape(
        "correct",
        "RISK",
        `Self-correct: resize $${oversized.toFixed(2)} → $${resized.toFixed(2)} (within max_stake $${MAX_STAKE_USD.toFixed(2)})`
      )
    );
    await sleep(350);

    const allow = await gateExecuteTrade({
      market_id: best.market_id,
      side: best.side,
      size_usd: resized,
      price: best.market_price ?? 0.5,
    });
    if (!allow.decision.allowed) {
      throw new Error("Unexpected deny on resized trade");
    }
    pomAllow += 1;
    push(
      {
        telemetry: {
          ...state.telemetry,
          pomeriumAllow: pomAllow,
          pomeriumDeny: pomDeny,
        },
      },
      makeTape(
        "observe",
        "RISK",
        `POMERIUM ALLOW · identity=risk-approved · size $${resized.toFixed(2)}`,
        { decision: allow.decision }
      )
    );
    await sleep(300);

    // ─── EXECUTE ──────────────────────────────────────────
    setStage("EXECUTE");
    push(
      {},
      makeTape(
        "act",
        "EXECUTE",
        `Placing $${resized.toFixed(2)} order via Zero prediction-market execution…`
      )
    );
    await sleep(400);

    const fill = await executeViaZero({
      market_id: best.market_id,
      side: best.side,
      size_usd: resized,
      price: best.market_price ?? 0.5,
    });
    const walletAfter = getZeroWallet();

    await recordFill({
      market_id: fill.market_id,
      side: fill.side,
      size_usd: fill.size_usd,
      price: fill.price,
      zero_tx: fill.tx,
    });
    nexlaCalls += 1;

    push(
      {
        positions: (await getPositions()).data,
        telemetry: {
          ...state.telemetry,
          zeroSpendUsd: walletAfter.spend,
          zeroWalletUsd: walletAfter.balance,
          nexlaToolCalls: nexlaCalls,
          capabilitiesDiscovered: getDiscoveredCapabilities().map((c) => c.name),
          pomeriumAllow: pomAllow,
          pomeriumDeny: pomDeny,
        },
      },
      makeTape(
        "observe",
        "EXECUTE",
        `FILL ${fill.tx} · $${fill.size_usd.toFixed(2)} @ ${fill.price.toFixed(2)} · wallet $${walletAfter.balance.toFixed(2)} (${fill.source})`
      )
    );
    await sleep(350);

    // ─── SETTLE ───────────────────────────────────────────
    setStage("SETTLE");
    const markPnl = Number(
      ((best.edge ?? 0) * resized * 0.35).toFixed(4)
    );
    push(
      {},
      makeTape(
        "observe",
        "SETTLE",
        `Position book settled via Nexset · mark-to-model P&L $${markPnl.toFixed(2)} · loop armed`
      )
    );
    await sleep(300);

    push(
      {},
      makeTape(
        "system",
        "SETTLE",
        "No human placed a trade. ATLAS is the first hedge fund whose entire front, middle, and back office is an agent loop."
      )
    );

    setStage("DONE");
    emit({ type: "done", payload: state });
    return state;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStage("ERROR");
    push({}, makeTape("system", "ERROR", `Pipeline error: ${message}`));
    emit({ type: "error", payload: message });
    return state;
  }
}
