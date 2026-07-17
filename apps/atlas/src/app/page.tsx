"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import type {
  FundState,
  OrchestratorEvent,
  PipelineStage,
  WorldModel,
} from "@/lib/types";
import { StageRail } from "@/components/StageRail";
import { AgentTape } from "@/components/AgentTape";
import { FundPanel } from "@/components/FundPanel";
import { TelemetryStrip } from "@/components/TelemetryStrip";
import { TopBanner } from "@/components/TopBanner";

const GlobeView = dynamic(() => import("@/components/GlobeView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center font-mono text-[11px] tracking-[0.15em] text-atlas-muted uppercase">
      Initializing globe…
    </div>
  ),
});

const STAGES: PipelineStage[] = [
  "INGEST",
  "MODEL",
  "SIMULATE",
  "RISK",
  "EXECUTE",
  "SETTLE",
];

function idleState(mode: "live" | "replay"): FundState {
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
    telemetry: {
      zeroSpendUsd: 0,
      zeroWalletUsd: 5,
      nexlaToolCalls: 0,
      pomeriumAllow: 0,
      pomeriumDeny: 0,
      akashLeaseId: "—",
      akashProvider: "—",
      akashEndpoint: "—",
      capabilitiesDiscovered: [],
    },
    tape: [],
    mode,
  };
}

function CommandCenterInner() {
  const searchParams = useSearchParams();
  const replayParam = searchParams.get("replay") === "1";
  const [mode] = useState<"live" | "replay">(replayParam ? "replay" : "live");
  const [state, setState] = useState<FundState>(() => idleState(mode));
  const [running, setRunning] = useState(false);
  const [worldModel, setWorldModel] = useState<WorldModel | null>(null);
  const [utc, setUtc] = useState("");

  useEffect(() => {
    fetch("/api/world-model")
      .then((r) => r.json())
      .then((data: WorldModel) => setWorldModel(data))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const tick = () =>
      setUtc(
        new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const runSimulation = useCallback(() => {
    if (running) return;
    setRunning(true);
    setState(idleState(mode));

    const es = new EventSource(
      `/api/simulate?replay=${mode === "replay" || replayParam ? "1" : "0"}`
    );

    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as OrchestratorEvent;
        // Prefer full state snapshots (already include tape) to avoid duplicate rows
        if (event.type === "state" || event.type === "done") {
          setState(event.payload as FundState);
          if (event.type === "done") {
            setRunning(false);
            es.close();
          }
        } else if (event.type === "stage") {
          setState((prev) => ({
            ...prev,
            stage: event.payload as PipelineStage,
          }));
        } else if (event.type === "error") {
          setRunning(false);
          es.close();
        }
      } catch {
        /* ignore malformed */
      }
    };

    es.onerror = () => {
      setRunning(false);
      es.close();
    };
  }, [running, mode, replayParam]);

  const activeStageIndex = useMemo(() => {
    if (state.stage === "IDLE" || state.stage === "ERROR") return -1;
    if (state.stage === "DONE") return STAGES.length;
    return STAGES.indexOf(state.stage);
  }, [state.stage]);

  const isIdle = state.stage === "IDLE" && !running;

  return (
    <div className="flex h-screen w-screen flex-col bg-atlas-bg text-atlas-text">
      <TopBanner
        clearance={state.clearance}
        denial={state.lastDenial}
        running={running}
        onRun={runSimulation}
        mode={mode}
        utc={utc}
      />
      <StageRail stages={STAGES} activeIndex={activeStageIndex} current={state.stage} />

      <div className="grid min-h-0 flex-1 grid-cols-12 border-t border-atlas-hairline">
        {/* Left: agent tape */}
        <aside className="col-span-3 flex min-h-0 flex-col border-r border-atlas-hairline">
          <div className="border-b border-atlas-hairline px-3 py-2 font-mono text-[10px] tracking-[0.15em] text-atlas-muted uppercase">
            Agent Tape · Plan / Act / Observe / Correct
          </div>
          <AgentTape tape={state.tape} idle={isIdle} />
        </aside>

        {/* Center: globe */}
        <main className="relative col-span-6 min-h-0">
          {isIdle && (
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center">
              <p className="font-mono text-[11px] tracking-[0.2em] text-atlas-muted uppercase">
                Fund Dormant — Awaiting Mandate
              </p>
              <p className="mt-2 max-w-sm text-center font-sans text-sm text-atlas-dim">
                Press RUN SIMULATION to ignite the autonomous loop.
              </p>
            </div>
          )}
          <GlobeView
            worldModel={worldModel}
            epicenter={state.event?.epicenter_node ?? null}
            affectedNodes={state.affectedNodes}
            affectedEdges={state.affectedEdges}
            propagationOrder={state.sim?.propagation_order ?? []}
            stage={state.stage}
            eventTitle={state.event?.title ?? null}
          />
        </main>

        {/* Right: fund */}
        <aside className="col-span-3 flex min-h-0 flex-col border-l border-atlas-hairline">
          <div className="border-b border-atlas-hairline px-3 py-2 font-mono text-[10px] tracking-[0.15em] text-atlas-muted uppercase">
            The Fund
          </div>
          <FundPanel state={state} />
        </aside>
      </div>

      <TelemetryStrip telemetry={state.telemetry} stage={state.stage} />
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center font-mono text-[11px] tracking-[0.15em] text-atlas-muted uppercase">
          Loading ATLAS…
        </div>
      }
    >
      <CommandCenterInner />
    </Suspense>
  );
}
