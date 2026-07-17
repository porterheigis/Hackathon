"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { deriveDisplayStage } from "@/lib/stage-display";

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
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-[12px] text-white/30">
      Loading satellite…
    </div>
  ),
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

const RECOVER_STAGE: Record<Phase, PipelineStage> = {
  idle: "IDLE",
  screening: "IDLE",
  awaiting_outcomes: "AWAITING_OUTCOMES",
  simulating: "AWAITING_OUTCOMES",
  playing: "AWAITING_APPROVAL",
  awaiting_approval: "AWAITING_APPROVAL",
  executing: "AWAITING_APPROVAL",
  done: "DONE",
};

function CommandCenterInner() {
  const searchParams = useSearchParams();
  const replayParam = searchParams.get("replay") === "1";
  const [mode] = useState<"live" | "replay">(replayParam ? "replay" : "live");
  const [state, setState] = useState<FundState>(() => emptyFundState(mode));
  const [running, setRunning] = useState(false);
  const [worldModel, setWorldModel] = useState<WorldModel | null>(null);
  const [worldModelError, setWorldModelError] = useState(false);
  const [utc, setUtc] = useState("");
  const [selectedOutcomes, setSelectedOutcomes] = useState<string[]>([]);
  const [selectedProposals, setSelectedProposals] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [tacticalOverride, setTacticalOverride] = useState(false);
  const [playbackReady, setPlaybackReady] = useState(false);
  const [pickerCollapsed, setPickerCollapsed] = useState(false);

  const esRef = useRef<EventSource | null>(null);
  const genRef = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const timeline = state.sim?.timeline ?? null;

  const onPlaybackDone = useCallback(() => {
    // Replay already executed on the server — settle after cinematic
    if (modeRef.current === "replay") {
      setPhase("done");
    } else {
      setPhase("awaiting_approval");
    }
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
      .then((data: WorldModel) => {
        setWorldModel(data);
        setWorldModelError(false);
      })
      .catch(() => setWorldModelError(true));
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
      setTacticalOverride((prev) => (prev ? false : prev));
      return;
    }
    const t = playback.t;
    const cutStart = timeline.events.find((e) => e.kind === "tactical_cutaway");
    const cutEnd = timeline.events.find((e) => e.kind === "tactical_end");
    if (!cutStart || !cutEnd) return;
    // Prefer duration on cutaway when present
    const duration =
      typeof cutStart.payload?.duration === "number"
        ? (cutStart.payload.duration as number)
        : cutEnd.t - cutStart.t;
    const endT = cutStart.t + duration;
    const next = t >= cutStart.t && t < endT;
    setTacticalOverride((prev) => (prev === next ? prev : next));
  }, [phase, timeline, playback.t]);

  const closeStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const fail = useCallback(
    (message: string, recover: Phase) => {
      setError(message);
      setRunning(false);
      setPhase(recover);
      setPlaybackReady(false);
      setTacticalOverride(false);
      setState((prev) => ({
        ...prev,
        stage: RECOVER_STAGE[recover],
        clearance: prev.clearance === "DENIED" ? "TRADER" : prev.clearance,
      }));
      closeStream();
    },
    [closeStream]
  );

  // Auto-run full pipeline in replay mode
  useEffect(() => {
    if (!replayParam) return;
    const gen = ++genRef.current;
    let settled = false;
    setRunning(true);
    setPhase("simulating");
    setError(null);
    setPickerCollapsed(true);

    const es = new EventSource("/api/simulate?replay=1");
    esRef.current = es;

    es.onmessage = (msg) => {
      if (gen !== genRef.current) return;
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
          // Intermediate phase completion — keep streaming until pipeline_done
          const s = event.payload as FundState;
          setState(s);
          if (s.affectedOutcomes?.length)
            setSelectedOutcomes(s.affectedOutcomes.map((o) => o.id));
          if (s.proposals?.length)
            setSelectedProposals(s.proposals.map((p) => p.id));
        } else if (event.type === "pipeline_done") {
          settled = true;
          const s = event.payload as FundState;
          setState(s);
          if (s.affectedOutcomes?.length)
            setSelectedOutcomes(s.affectedOutcomes.map((o) => o.id));
          if (s.proposals?.length)
            setSelectedProposals(s.proposals.map((p) => p.id));
          if (s.sim?.timeline) {
            setPhase("playing");
            setPlaybackReady(true);
          } else {
            setRunning(false);
            setPhase("done");
          }
          closeStream();
        } else if (event.type === "error") {
          settled = true;
          fail(String(event.payload ?? "Replay failed"), "idle");
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    es.onerror = () => {
      if (settled || gen !== genRef.current) return;
      settled = true;
      fail("Connection lost during replay", "idle");
    };

    return () => {
      settled = true;
      if (gen === genRef.current) {
        closeStream();
      } else {
        es.close();
      }
    };
  }, [replayParam, fail, closeStream]);

  const handleNewScenario = useCallback(() => {
    genRef.current += 1;
    closeStream();
    setState(emptyFundState(mode));
    setSelectedOutcomes([]);
    setSelectedProposals([]);
    setPhase("idle");
    setRunning(false);
    setError(null);
    setPlaybackReady(false);
    setTacticalOverride(false);
    setPickerCollapsed(false);
    playback.reset();
  }, [mode, playback, closeStream]);

  const handleScreen = useCallback(
    (opts: { text?: string; preset_id?: string }) => {
      if (running) return;
      const gen = ++genRef.current;
      let settled = false;
      closeStream();
      setRunning(true);
      setPhase("screening");
      setState(emptyFundState(mode));
      setSelectedOutcomes([]);
      setSelectedProposals([]);
      setError(null);
      setPlaybackReady(false);
      setPickerCollapsed(false);

      const params = new URLSearchParams();
      if (opts.preset_id) params.set("preset_id", opts.preset_id);
      if (opts.text) params.set("text", opts.text);
      if (mode === "replay") params.set("replay", "1");

      const es = new EventSource(`/api/screen?${params.toString()}`);
      esRef.current = es;
      es.onmessage = (msg) => {
        if (gen !== genRef.current) return;
        try {
          const event = JSON.parse(msg.data) as OrchestratorEvent;
          if (event.type === "state" || event.type === "done") {
            const s = event.payload as FundState;
            setState(s);
            if (event.type === "done") {
              settled = true;
              setRunning(false);
              setPhase("awaiting_outcomes");
              setSelectedOutcomes(s.affectedOutcomes.map((o) => o.id));
              closeStream();
            }
          } else if (event.type === "stage") {
            setState((prev) => ({
              ...prev,
              stage: event.payload as PipelineStage,
            }));
          } else if (event.type === "error") {
            settled = true;
            fail(String(event.payload ?? "Screen failed"), "idle");
          }
        } catch {
          /* */
        }
      };
      es.onerror = () => {
        if (settled || gen !== genRef.current) return;
        settled = true;
        fail("Connection lost while screening", "idle");
      };
    },
    [running, mode, fail, closeStream]
  );

  const handleSimulate = useCallback(() => {
    const scenarioId = state.scenario?.scenario_id;
    if (!scenarioId || !selectedOutcomes.length || running) return;
    const gen = ++genRef.current;
    let settled = false;
    closeStream();
    setRunning(true);
    setPhase("simulating");
    setError(null);
    setPlaybackReady(false);
    setPickerCollapsed(true);

    const params = new URLSearchParams({
      scenario_id: scenarioId,
      outcomes: selectedOutcomes.join(","),
    });
    const es = new EventSource(`/api/simulate?${params.toString()}`);
    esRef.current = es;
    es.onmessage = (msg) => {
      if (gen !== genRef.current) return;
      try {
        const event = JSON.parse(msg.data) as OrchestratorEvent;
        if (event.type === "state") {
          const s = event.payload as FundState;
          setState(s);
        } else if (event.type === "done") {
          settled = true;
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
          closeStream();
        } else if (event.type === "stage") {
          setState((prev) => ({
            ...prev,
            stage: event.payload as PipelineStage,
          }));
        } else if (event.type === "error") {
          settled = true;
          fail(String(event.payload ?? "Simulation failed"), "awaiting_outcomes");
        }
      } catch {
        /* */
      }
    };
    es.onerror = () => {
      if (settled || gen !== genRef.current) return;
      settled = true;
      fail("Connection lost during simulation", "awaiting_outcomes");
    };
  }, [
    state.scenario?.scenario_id,
    selectedOutcomes,
    running,
    fail,
    closeStream,
  ]);

  const handleExecute = useCallback(() => {
    const scenarioId = state.scenario?.scenario_id;
    if (!scenarioId || !selectedProposals.length || running) return;
    const gen = ++genRef.current;
    let settled = false;
    closeStream();
    setRunning(true);
    setPhase("executing");
    setError(null);

    const params = new URLSearchParams({
      scenario_id: scenarioId,
      proposal_ids: selectedProposals.join(","),
    });
    const es = new EventSource(`/api/execute?${params.toString()}`);
    esRef.current = es;
    es.onmessage = (msg) => {
      if (gen !== genRef.current) return;
      try {
        const event = JSON.parse(msg.data) as OrchestratorEvent;
        if (event.type === "state" || event.type === "done") {
          setState(event.payload as FundState);
          if (event.type === "done") {
            settled = true;
            setRunning(false);
            setPhase("done");
            closeStream();
          }
        } else if (event.type === "stage") {
          setState((prev) => ({
            ...prev,
            stage: event.payload as PipelineStage,
          }));
        } else if (event.type === "error") {
          settled = true;
          fail(String(event.payload ?? "Execution failed"), "awaiting_approval");
        }
      } catch {
        /* */
      }
    };
    es.onerror = () => {
      if (settled || gen !== genRef.current) return;
      settled = true;
      fail("Connection lost during execution", "awaiting_approval");
    };
  }, [
    state.scenario?.scenario_id,
    selectedProposals,
    running,
    fail,
    closeStream,
  ]);

  const display = useMemo(
    () => deriveDisplayStage(state.stage, phase),
    [state.stage, phase]
  );

  const showIdleHero =
    phase === "idle" ||
    (phase === "screening" && !state.affectedOutcomes.length);

  const showOutcomePickerFull =
    phase === "awaiting_outcomes" && state.affectedOutcomes.length > 0;

  const showOutcomePickerSummary =
    pickerCollapsed &&
    state.affectedOutcomes.length > 0 &&
    (phase === "simulating" || phase === "playing");

  const showProposals =
    (phase === "awaiting_approval" || phase === "executing") &&
    state.proposals.length > 0;

  const showFundSettled = phase === "done" || state.stage === "DONE";

  const isPlaying = phase === "playing";
  // Only show tactical via timeline cutaway — never from orchestrator viewport flash
  const showTactical = tacticalOverride;

  const stageLabel = display.label;

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
        activeIndex={display.activeIndex}
        current={display.railStage}
      />

      <div className="grid min-h-0 flex-1 grid-cols-12">
        <aside className="col-span-3 flex min-h-0 flex-col border-r border-atlas-hairline">
          <div className="border-b border-atlas-hairline px-3 py-2">
            <p className="eyebrow">Agent tape</p>
          </div>
          {showOutcomePickerFull && (
            <OutcomePicker
              outcomes={state.affectedOutcomes}
              selected={selectedOutcomes}
              onChange={setSelectedOutcomes}
              onRun={handleSimulate}
              loading={false}
            />
          )}
          {showOutcomePickerSummary && (
            <div className="border-b border-atlas-hairline px-3 py-2">
              <p className="font-mono text-[11px] text-white/55">
                {selectedOutcomes.length} outcomes ·{" "}
                {phase === "playing" ? "playback" : "simulating"}
              </p>
            </div>
          )}
          <AgentTape
            tape={state.tape}
            idle={state.tape.length === 0 && !running && phase === "idle"}
          />
        </aside>

        <main className="relative col-span-6 min-h-0 overflow-hidden">
          {worldModelError && !worldModel && (
            <div className="absolute left-3 top-3 z-30 rounded border border-atlas-red/40 bg-atlas-bg/80 px-2 py-1 font-mono text-[10px] text-atlas-red">
              World model failed to load
            </div>
          )}
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
            stage={display.railStage}
            eventTitle={state.event?.title ?? null}
            visible={!showTactical}
            playbackT={isPlaying ? playback.t : null}
            timeline={timeline}
            playing={isPlaying}
          />
          <TacticalView
            worldModel={worldModel}
            epicenter={state.event?.epicenter_node ?? null}
            stage={display.railStage}
            detections={state.sim?.detections ?? []}
            vesselCount={state.sim?.vessel_count ?? 0}
            visible={showTactical}
            eventTitle={state.event?.title ?? null}
            timeline={timeline}
            playbackT={isPlaying ? playback.t : null}
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

        <aside className="col-span-3 flex min-h-0 flex-col border-l border-atlas-hairline">
          <div className="border-b border-atlas-hairline px-3 py-2">
            <p className="eyebrow">The fund</p>
          </div>
          <AnimatePresence mode="wait">
            {showProposals ? (
              <ProposalPanel
                key="proposals"
                proposals={state.proposals}
                selected={selectedProposals}
                onChange={setSelectedProposals}
                onExecute={handleExecute}
                loading={phase === "executing"}
                denial={state.lastDenial}
                onNewScenario={handleNewScenario}
              />
            ) : (
              <FundPanel
                key="fund"
                state={state}
                showNewScenario={
                  showFundSettled || phase === "awaiting_approval"
                }
                onNewScenario={handleNewScenario}
              />
            )}
          </AnimatePresence>
        </aside>
      </div>

      <TelemetryStrip telemetry={state.telemetry} stage={display.railStage} />
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
