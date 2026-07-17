"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { AnimatePresence } from "framer-motion";
import type {
  FundState,
  OrchestratorEvent,
  PipelineStage,
  WorldModel,
} from "@/lib/types";
import { emptyFundState } from "@/lib/store-client";
import { usePlayback } from "@/lib/usePlayback";
import { StageRail } from "@/components/StageRail";
import { AgentTape } from "@/components/AgentTape";
import { FundPanel } from "@/components/FundPanel";
import { TelemetryStrip } from "@/components/TelemetryStrip";
import { TopBanner } from "@/components/TopBanner";
import { ScenarioInput } from "@/components/ScenarioInput";
import { OutcomePicker } from "@/components/OutcomePicker";
import { ProposalPanel } from "@/components/ProposalPanel";
import { SimTheaterHUD } from "@/components/SimTheaterHUD";

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

type Phase =
  | "idle"
  | "screening"
  | "awaiting_outcomes"
  | "simulating"
  | "playing"
  | "awaiting_approval"
  | "executing"
  | "done";

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
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [tacticalOverride, setTacticalOverride] = useState(false);
  const [playbackReady, setPlaybackReady] = useState(false);

  const timeline = state.sim?.timeline ?? null;

  const onPlaybackDone = useCallback(() => {
    setPhase("awaiting_approval");
    setRunning(false);
    setTacticalOverride(false);
    setPlaybackReady(false);
  }, []);

  const playback = usePlayback(playbackReady ? timeline : null, {
    autoStart: true,
    onDone: onPlaybackDone,
  });

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

  // Tactical cutaway during playback based on timeline events
  useEffect(() => {
    if (phase !== "playing" || !timeline) {
      setTacticalOverride(false);
      return;
    }
    const t = playback.t;
    const cutStart = timeline.events.find((e) => e.kind === "tactical_cutaway");
    const cutEnd = timeline.events.find((e) => e.kind === "tactical_end");
    if (cutStart && cutEnd) {
      setTacticalOverride(t >= cutStart.t && t < cutEnd.t);
    }
  }, [phase, timeline, playback.t]);

  const fail = useCallback((message: string, recover: Phase) => {
    setError(message);
    setRunning(false);
    setPhase(recover);
    setPlaybackReady(false);
    setTacticalOverride(false);
  }, []);

  // Auto-run full pipeline in replay mode — still plays shortened cinematic
  useEffect(() => {
    if (!replayParam) return;
    setRunning(true);
    setPhase("simulating");
    setError(null);
    const es = new EventSource("/api/simulate?replay=1");
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as OrchestratorEvent;
        if (event.type === "state") {
          const s = event.payload as FundState;
          setState(s);
          if (s.affectedOutcomes?.length)
            setSelectedOutcomes(s.affectedOutcomes.map((o) => o.id));
          if (s.proposals?.length)
            setSelectedProposals(s.proposals.map((p) => p.id));
        } else if (event.type === "done") {
          const s = event.payload as FundState;
          setState(s);
          if (s.affectedOutcomes?.length)
            setSelectedOutcomes(s.affectedOutcomes.map((o) => o.id));
          if (s.proposals?.length)
            setSelectedProposals(s.proposals.map((p) => p.id));
          // Replay pipeline continues to execute after playback in a chained way —
          // for replay=1 the API already ran full pipeline. Show playback then settle.
          if (s.sim?.timeline && s.stage !== "DONE") {
            setPhase("playing");
            setPlaybackReady(true);
          } else if (s.sim?.timeline) {
            // Full pipeline done: still show a quick playback before settled view
            setPhase("playing");
            setPlaybackReady(true);
          } else {
            setRunning(false);
            setPhase("done");
          }
          es.close();
        } else if (event.type === "error") {
          fail(String(event.payload ?? "Replay failed"), "idle");
          es.close();
        }
      } catch {
        /* */
      }
    };
    es.onerror = () => {
      fail("Connection lost during replay", "idle");
      es.close();
    };
  }, [replayParam, fail]);

  const handleNewScenario = useCallback(() => {
    setState(emptyFundState(mode));
    setSelectedOutcomes([]);
    setSelectedProposals([]);
    setPhase("idle");
    setRunning(false);
    setError(null);
    setPlaybackReady(false);
    setTacticalOverride(false);
    playback.reset();
  }, [mode, playback]);

  const handleScreen = useCallback(
    (opts: { text?: string; preset_id?: string }) => {
      if (running) return;
      setRunning(true);
      setPhase("screening");
      setState(emptyFundState(mode));
      setSelectedOutcomes([]);
      setSelectedProposals([]);
      setError(null);
      setPlaybackReady(false);

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
              setSelectedOutcomes(s.affectedOutcomes.map((o) => o.id));
              es.close();
            }
          } else if (event.type === "stage") {
            setState((prev) => ({
              ...prev,
              stage: event.payload as PipelineStage,
            }));
          } else if (event.type === "error") {
            fail(String(event.payload ?? "Screen failed"), "idle");
            es.close();
          }
        } catch {
          /* */
        }
      };
      es.onerror = () => {
        fail("Connection lost while screening", "idle");
        es.close();
      };
    },
    [running, mode, fail]
  );

  const handleSimulate = useCallback(() => {
    const scenarioId = state.scenario?.scenario_id;
    if (!scenarioId || !selectedOutcomes.length || running) return;
    setRunning(true);
    setPhase("simulating");
    setError(null);
    setPlaybackReady(false);

    const params = new URLSearchParams({
      scenario_id: scenarioId,
      outcomes: selectedOutcomes.join(","),
    });
    const es = new EventSource(`/api/simulate?${params.toString()}`);
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as OrchestratorEvent;
        if (event.type === "state") {
          const s = event.payload as FundState;
          setState(s);
        } else if (event.type === "done") {
          const s = event.payload as FundState;
          setState(s);
          setSelectedProposals(s.proposals.map((p) => p.id));
          if (s.sim?.timeline) {
            setPhase("playing");
            setPlaybackReady(true);
          } else {
            setRunning(false);
            setPhase("awaiting_approval");
          }
          es.close();
        } else if (event.type === "stage") {
          setState((prev) => ({
            ...prev,
            stage: event.payload as PipelineStage,
          }));
        } else if (event.type === "error") {
          fail(String(event.payload ?? "Simulation failed"), "awaiting_outcomes");
          es.close();
        }
      } catch {
        /* */
      }
    };
    es.onerror = () => {
      fail("Connection lost during simulation", "awaiting_outcomes");
      es.close();
    };
  }, [state.scenario?.scenario_id, selectedOutcomes, running, fail]);

  const handleExecute = useCallback(() => {
    const scenarioId = state.scenario?.scenario_id;
    if (!scenarioId || !selectedProposals.length || running) return;
    setRunning(true);
    setPhase("executing");
    setError(null);

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
            setPhase("done");
            es.close();
          }
        } else if (event.type === "stage") {
          setState((prev) => ({
            ...prev,
            stage: event.payload as PipelineStage,
          }));
        } else if (event.type === "error") {
          fail(String(event.payload ?? "Execution failed"), "awaiting_approval");
          es.close();
        }
      } catch {
        /* */
      }
    };
    es.onerror = () => {
      fail("Connection lost during execution", "awaiting_approval");
      es.close();
    };
  }, [state.scenario?.scenario_id, selectedProposals, running, fail]);

  const activeStageIndex = useMemo(() => {
    if (phase === "playing") return STAGES.indexOf("SIMULATE");
    if (state.stage === "IDLE" || state.stage === "ERROR") return -1;
    if (state.stage === "AWAITING_OUTCOMES") return STAGES.indexOf("SCREEN");
    if (state.stage === "AWAITING_APPROVAL") return STAGES.indexOf("PROPOSE");
    if (state.stage === "DONE") return STAGES.length;
    const idx = STAGES.indexOf(state.stage);
    return idx;
  }, [state.stage, phase]);

  const showIdleHero =
    phase === "idle" ||
    (phase === "screening" && !state.affectedOutcomes.length);

  const showOutcomePicker =
    phase === "awaiting_outcomes" ||
    phase === "simulating" ||
    (state.stage === "AWAITING_OUTCOMES" && phase !== "playing");

  const showProposals =
    (phase === "awaiting_approval" || phase === "executing") &&
    state.proposals.length > 0;

  const showFundSettled = phase === "done" || state.stage === "DONE";

  const isPlaying = phase === "playing";
  const showTactical =
    tacticalOverride || (state.viewport === "tactical" && !isPlaying);

  const stageLabel = isPlaying
    ? "SIMULATE · PLAYBACK"
    : state.stage !== "IDLE"
      ? state.stage
      : undefined;

  return (
    <div className="flex h-screen w-screen flex-col bg-atlas-bg text-atlas-text">
      <TopBanner
        clearance={state.clearance}
        denial={state.lastDenial}
        mode={mode}
        utc={utc}
        stageLabel={stageLabel}
        error={error}
        onDismissError={() => setError(null)}
      />
      <StageRail
        stages={STAGES}
        activeIndex={activeStageIndex}
        current={isPlaying ? "SIMULATE" : state.stage}
      />

      <div className="grid min-h-0 flex-1 grid-cols-12 border-t border-white/[0.08]">
        <aside className="col-span-3 flex min-h-0 flex-col border-r border-white/[0.08]">
          <div className="border-b border-white/[0.08] px-3 py-2">
            <p className="eyebrow">Agent tape</p>
          </div>
          {showOutcomePicker && state.affectedOutcomes.length > 0 && (
            <OutcomePicker
              outcomes={state.affectedOutcomes}
              selected={selectedOutcomes}
              onChange={setSelectedOutcomes}
              onRun={handleSimulate}
              loading={phase === "simulating" || phase === "playing"}
            />
          )}
          <AgentTape tape={state.tape} idle={showIdleHero && phase === "idle"} />
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
            selectedOutcomes={
              state.selectedOutcomes.length
                ? state.selectedOutcomes
                : selectedOutcomes
            }
            propagationOrder={state.sim?.propagation_order ?? []}
            tickers={state.sim?.tickers ?? []}
            stage={isPlaying ? "SIMULATE" : state.stage}
            eventTitle={state.event?.title ?? null}
            visible={!showTactical}
            playbackT={isPlaying ? playback.t : null}
            timeline={timeline}
            playing={isPlaying}
          />
          <TacticalView
            worldModel={worldModel}
            epicenter={state.event?.epicenter_node ?? null}
            stage={isPlaying ? "SIMULATE" : state.stage}
            detections={state.sim?.detections ?? []}
            vesselCount={state.sim?.vessel_count ?? 0}
            visible={showTactical}
            eventTitle={state.event?.title ?? null}
          />
          <AnimatePresence>
            {isPlaying && (
              <SimTheaterHUD
                clockLabel={playback.clockLabel}
                phase={playback.phase}
                progress={playback.progress}
                nSims={state.sim?.n_sims}
                vesselCount={state.sim?.vessel_count}
                assetCount={timeline?.assets.length}
                onSkip={playback.skip}
              />
            )}
          </AnimatePresence>
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
            <FundPanel
              state={state}
              showNewScenario={showFundSettled || phase === "awaiting_approval"}
              onNewScenario={handleNewScenario}
            />
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
