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
import { emptyFundState } from "@/lib/store-client";
import { StageRail } from "@/components/StageRail";
import { AgentTape } from "@/components/AgentTape";
import { FundPanel } from "@/components/FundPanel";
import { TelemetryStrip } from "@/components/TelemetryStrip";
import { TopBanner } from "@/components/TopBanner";
import { ScenarioInput } from "@/components/ScenarioInput";
import { OutcomePicker } from "@/components/OutcomePicker";
import { ProposalPanel } from "@/components/ProposalPanel";

const GlobeView = dynamic(() => import("@/components/GlobeView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-[12px] text-white/30">
      Loading Earth…
    </div>
  ),
});

const TacticalView = dynamic(() => import("@/components/TacticalView"), {
  ssr: false,
});

const STAGES: PipelineStage[] = [
  "SCENARIO",
  "SCREEN",
  "MODEL",
  "SIMULATE",
  "PROPOSE",
  "RISK",
  "EXECUTE",
  "SETTLE",
];

function CommandCenterInner() {
  const searchParams = useSearchParams();
  const replayParam = searchParams.get("replay") === "1";
  const [mode] = useState<"live" | "replay">(replayParam ? "replay" : "live");
  const [state, setState] = useState<FundState>(() => emptyFundState(mode));
  const [running, setRunning] = useState(false);
  const [worldModel, setWorldModel] = useState<WorldModel | null>(null);
  const [utc, setUtc] = useState("");
  const [selectedOutcomes, setSelectedOutcomes] = useState<string[]>([]);
  const [selectedProposals, setSelectedProposals] = useState<string[]>([]);
  const [phase, setPhase] = useState<
    "idle" | "screening" | "awaiting_outcomes" | "simulating" | "awaiting_approval" | "executing"
  >("idle");

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

  // Auto-run full pipeline in replay mode
  useEffect(() => {
    if (!replayParam) return;
    setRunning(true);
    setPhase("executing");
    const es = new EventSource("/api/simulate?replay=1");
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as OrchestratorEvent;
        if (event.type === "state" || event.type === "done") {
          const s = event.payload as FundState;
          setState(s);
          if (s.affectedOutcomes?.length)
            setSelectedOutcomes(s.affectedOutcomes.map((o) => o.id));
          if (s.proposals?.length)
            setSelectedProposals(s.proposals.map((p) => p.id));
          if (event.type === "done") {
            setRunning(false);
            setPhase("idle");
            es.close();
          }
        } else if (event.type === "error") {
          setRunning(false);
          setPhase("idle");
          es.close();
        }
      } catch {
        /* */
      }
    };
    es.onerror = () => {
      setRunning(false);
      setPhase("idle");
      es.close();
    };
  }, [replayParam]);

  const handleScreen = useCallback(
    (opts: { text?: string; preset_id?: string }) => {
      if (running) return;
      setRunning(true);
      setPhase("screening");
      setState(emptyFundState(mode));
      setSelectedOutcomes([]);
      setSelectedProposals([]);

      const params = new URLSearchParams();
      if (opts.preset_id) params.set("preset_id", opts.preset_id);
      if (opts.text) params.set("text", opts.text);
      if (mode === "replay") params.set("replay", "1");

      const es = new EventSource(`/api/screen?${params.toString()}`);
      es.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as OrchestratorEvent;
          if (event.type === "state" || event.type === "done") {
            const s = event.payload as FundState;
            setState(s);
            if (event.type === "done") {
              setRunning(false);
              setPhase("awaiting_outcomes");
              // Pre-select all screened outcomes
              setSelectedOutcomes(s.affectedOutcomes.map((o) => o.id));
              es.close();
            }
          } else if (event.type === "stage") {
            setState((prev) => ({
              ...prev,
              stage: event.payload as PipelineStage,
            }));
          } else if (event.type === "error") {
            setRunning(false);
            setPhase("idle");
            es.close();
          }
        } catch {
          /* */
        }
      };
      es.onerror = () => {
        setRunning(false);
        setPhase("idle");
        es.close();
      };
    },
    [running, mode]
  );

  const handleSimulate = useCallback(() => {
    const scenarioId = state.scenario?.scenario_id;
    if (!scenarioId || !selectedOutcomes.length || running) return;
    setRunning(true);
    setPhase("simulating");

    const params = new URLSearchParams({
      scenario_id: scenarioId,
      outcomes: selectedOutcomes.join(","),
    });
    const es = new EventSource(`/api/simulate?${params.toString()}`);
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as OrchestratorEvent;
        if (event.type === "state" || event.type === "done") {
          const s = event.payload as FundState;
          setState(s);
          if (event.type === "done") {
            setRunning(false);
            setPhase("awaiting_approval");
            setSelectedProposals(s.proposals.map((p) => p.id));
            es.close();
          }
        } else if (event.type === "stage") {
          setState((prev) => ({
            ...prev,
            stage: event.payload as PipelineStage,
          }));
        } else if (event.type === "error") {
          setRunning(false);
          setPhase("awaiting_outcomes");
          es.close();
        }
      } catch {
        /* */
      }
    };
    es.onerror = () => {
      setRunning(false);
      setPhase("awaiting_outcomes");
      es.close();
    };
  }, [state.scenario?.scenario_id, selectedOutcomes, running]);

  const handleExecute = useCallback(() => {
    const scenarioId = state.scenario?.scenario_id;
    if (!scenarioId || !selectedProposals.length || running) return;
    setRunning(true);
    setPhase("executing");

    const params = new URLSearchParams({
      scenario_id: scenarioId,
      proposal_ids: selectedProposals.join(","),
    });
    const es = new EventSource(`/api/execute?${params.toString()}`);
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as OrchestratorEvent;
        if (event.type === "state" || event.type === "done") {
          setState(event.payload as FundState);
          if (event.type === "done") {
            setRunning(false);
            setPhase("idle");
            es.close();
          }
        } else if (event.type === "stage") {
          setState((prev) => ({
            ...prev,
            stage: event.payload as PipelineStage,
          }));
        } else if (event.type === "error") {
          setRunning(false);
          setPhase("awaiting_approval");
          es.close();
        }
      } catch {
        /* */
      }
    };
    es.onerror = () => {
      setRunning(false);
      setPhase("awaiting_approval");
      es.close();
    };
  }, [state.scenario?.scenario_id, selectedProposals, running]);

  const activeStageIndex = useMemo(() => {
    if (state.stage === "IDLE" || state.stage === "ERROR") return -1;
    if (state.stage === "AWAITING_OUTCOMES") return STAGES.indexOf("SCREEN");
    if (state.stage === "AWAITING_APPROVAL") return STAGES.indexOf("PROPOSE");
    if (state.stage === "DONE") return STAGES.length;
    const idx = STAGES.indexOf(state.stage);
    return idx;
  }, [state.stage]);

  const showIdleHero =
    (phase === "idle" || phase === "screening") &&
    (state.stage === "IDLE" || state.stage === "SCENARIO" || state.stage === "SCREEN") &&
    !replayParam &&
    !state.affectedOutcomes.length;

  const showOutcomePicker =
    phase === "awaiting_outcomes" ||
    state.stage === "AWAITING_OUTCOMES";

  const showProposals =
    (phase === "awaiting_approval" ||
      phase === "executing" ||
      state.stage === "AWAITING_APPROVAL" ||
      state.proposals.length > 0) &&
    state.proposals.length > 0;

  const showTactical = state.viewport === "tactical";

  return (
    <div className="flex h-screen w-screen flex-col bg-atlas-bg text-atlas-text">
      <TopBanner
        clearance={state.clearance}
        denial={state.lastDenial}
        mode={mode}
        utc={utc}
        stageLabel={state.stage !== "IDLE" ? state.stage : undefined}
      />
      <StageRail
        stages={STAGES}
        activeIndex={activeStageIndex}
        current={state.stage}
      />

      <div className="grid min-h-0 flex-1 grid-cols-12 border-t border-white/[0.08]">
        <aside className="col-span-3 flex min-h-0 flex-col border-r border-white/[0.08]">
          <div className="border-b border-white/[0.08] px-3 py-2">
            <p className="eyebrow">Agent tape</p>
          </div>
          {showOutcomePicker && (
            <OutcomePicker
              outcomes={state.affectedOutcomes}
              selected={selectedOutcomes}
              onChange={setSelectedOutcomes}
              onRun={handleSimulate}
              loading={phase === "simulating"}
            />
          )}
          <AgentTape
            tape={state.tape}
            idle={showIdleHero}
          />
        </aside>

        <main className="relative col-span-6 min-h-0 overflow-hidden">
          {showIdleHero && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-atlas-bg/40 backdrop-blur-[2px]">
              <ScenarioInput
                onSubmit={handleScreen}
                loading={phase === "screening"}
              />
            </div>
          )}
          <GlobeView
            worldModel={worldModel}
            epicenter={state.event?.epicenter_node ?? null}
            affectedNodes={state.affectedNodes}
            affectedEdges={state.affectedEdges}
            disruptedEdges={state.disruptedEdges}
            selectedOutcomes={state.selectedOutcomes.length ? state.selectedOutcomes : selectedOutcomes}
            propagationOrder={state.sim?.propagation_order ?? []}
            tickers={state.sim?.tickers ?? []}
            stage={state.stage}
            eventTitle={state.event?.title ?? null}
            visible={!showTactical}
          />
          <TacticalView
            worldModel={worldModel}
            epicenter={state.event?.epicenter_node ?? null}
            stage={state.stage}
            detections={state.sim?.detections ?? []}
            vesselCount={state.sim?.vessel_count ?? 0}
            visible={showTactical}
            eventTitle={state.event?.title ?? null}
          />
        </main>

        <aside className="col-span-3 flex min-h-0 flex-col border-l border-white/[0.08]">
          <div className="border-b border-white/[0.08] px-3 py-2">
            <p className="eyebrow">The fund</p>
          </div>
          {showProposals ? (
            <ProposalPanel
              proposals={state.proposals}
              selected={selectedProposals}
              onChange={setSelectedProposals}
              onExecute={handleExecute}
              loading={phase === "executing"}
              denial={state.lastDenial}
            />
          ) : (
            <FundPanel state={state} />
          )}
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
        <div className="flex h-screen items-center justify-center text-[12px] text-white/30">
          Loading Atlas…
        </div>
      }
    >
      <CommandCenterInner />
    </Suspense>
  );
}
