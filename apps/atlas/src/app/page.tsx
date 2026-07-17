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
import {
  DISPLAY_STEPS,
  getPresentationState,
  type DrawerTab,
  type Phase,
} from "@/lib/presentation";
import { emptyFundState } from "@/lib/store-client";
import { usePlayback } from "@/lib/usePlayback";
import { StageRail } from "@/components/StageRail";
import { SponsorRail } from "@/components/SponsorRail";
import { SimTheaterHUD } from "@/components/SimTheaterHUD";
import { EventCard } from "@/components/EventCard";
import { PnlCard } from "@/components/PnlCard";
import { PartnerDock } from "@/components/PartnerDock";
import { CommandDrawer } from "@/components/CommandDrawer";

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

// Keep absent simulation collections referentially stable. GlobeView observes
// these arrays in an effect, so allocating a fresh [] during the SIMULATE
// transition would retrigger that effect after each of its state updates.
const EMPTY_SIMULATION_LIST: never[] = [];

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
  const [playbackReady, setPlaybackReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("activity");

  const esRef = useRef<EventSource | null>(null);
  const genRef = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const timeline = state.sim?.timeline ?? null;

  const onPlaybackDone = useCallback(() => {
    setPhase(modeRef.current === "replay" ? "done" : "awaiting_approval");
    setRunning(false);
    setPlaybackReady(false);
  }, []);

  const playback = usePlayback(playbackReady ? timeline : null, {
    autoStart: true,
    onDone: onPlaybackDone,
  });

  useEffect(() => {
    fetch("/api/world-model")
      .then((r) => r.json())
      .then((data: WorldModel & { error?: string; _meta?: unknown }) => {
        if (data.error || !Array.isArray(data.nodes)) return;
        const { _meta: _ignored, ...model } = data;
        setWorldModel(model as WorldModel);
      })
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

  // The tactical cutaway is derived from playback rather than mirrored into
  // state. Updating state from every playback frame causes a nested render
  // chain in React 19 once the cinematic has run for long enough.
  const tacticalOverride = useMemo(() => {
    if (phase !== "playing" || !timeline) return false;
    const cutStart = timeline.events.find((e) => e.kind === "tactical_cutaway");
    const cutEnd = timeline.events.find((e) => e.kind === "tactical_end");
    if (!cutStart || !cutEnd) return false;
    const duration =
      typeof cutStart.payload?.duration === "number"
        ? cutStart.payload.duration
        : cutEnd.t - cutStart.t;
    return playback.t >= cutStart.t && playback.t < cutStart.t + duration;
  }, [phase, timeline, playback.t]);

  const closeStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  const fail = useCallback(
    (message: string, recover: Phase) => {
      setError(message);
      setRunning(false);
      setPhase(recover);
      setPlaybackReady(false);
      setState((prev) => ({
        ...prev,
        stage: RECOVER_STAGE[recover],
        clearance: prev.clearance === "DENIED" ? "TRADER" : prev.clearance,
      }));
      closeStream();
    },
    [closeStream]
  );

  // Auto-run the full pipeline in replay mode, but keep the stream open until
  // the orchestrator emits its single terminal event.
  useEffect(() => {
    if (!replayParam) return;
    const gen = ++genRef.current;
    let settled = false;
    setRunning(true);
    setPhase("simulating");
    setError(null);

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
          // Phase completion is intermediate during a full replay.
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
        /* */
      }
    };
    es.onerror = () => {
      if (settled || gen !== genRef.current) return;
      settled = true;
      fail("Connection lost during replay", "idle");
    };

    return () => {
      settled = true;
      if (gen === genRef.current) closeStream();
      else es.close();
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
    setDrawerOpen(false);
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
    setDrawerOpen(false);

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
    setDrawerOpen(false);

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

  const presentation = useMemo(
    () =>
      getPresentationState({
        phase,
        stage: state.stage,
        selectedOutcomeCount: selectedOutcomes.length,
        selectedProposalCount: selectedProposals.length,
      }),
    [phase, state.stage, selectedOutcomes.length, selectedProposals.length]
  );

  useEffect(() => {
    if (!presentation.requiredPanel) return;
    setDrawerTab(presentation.requiredPanel);
    setDrawerOpen(true);
  }, [presentation.requiredPanel]);

  const openDrawer = useCallback((tab: DrawerTab) => {
    setDrawerTab(tab);
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const handlePrimaryAction = useCallback(() => {
    if (presentation.ctaDisabled) return;
    if (presentation.ctaAction === "focus-scenario") {
      document.getElementById("scenario-command")?.focus();
    } else if (presentation.ctaAction === "simulate") {
      handleSimulate();
    } else if (presentation.ctaAction === "execute") {
      handleExecute();
    } else if (presentation.ctaAction === "new-scenario") {
      handleNewScenario();
    }
  }, [presentation, handleSimulate, handleExecute, handleNewScenario]);

  const isPlaying = phase === "playing";
  const showTactical = tacticalOverride;

  return (
    <div className="cockpit-shell">
      <main className="cockpit-stage">
        <div className="opening-sequence" aria-hidden="true">
          <div className="opening-brand">
            <span className="atlas-glyph"><i /></span>
            <span className="atlas-wordmark opening-wordmark">
              <strong>Atlas</strong><em>Capital</em>
            </span>
          </div>
        </div>

        <div className="globe-layer">
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
            propagationOrder={
              state.sim?.propagation_order ?? EMPTY_SIMULATION_LIST
            }
            tickers={state.sim?.tickers ?? EMPTY_SIMULATION_LIST}
            stage={isPlaying ? "SIMULATE" : state.stage}
            eventTitle={state.event?.title ?? null}
            visible={!showTactical}
            playbackT={isPlaying ? playback.t : null}
            timeline={timeline}
            playing={isPlaying}
            getT={playback.getT}
          />
          <TacticalView
            worldModel={worldModel}
            epicenter={state.event?.epicenter_node ?? null}
            stage={isPlaying ? "SIMULATE" : state.stage}
            detections={state.sim?.detections ?? EMPTY_SIMULATION_LIST}
            vesselCount={state.sim?.vessel_count ?? 0}
            visible={showTactical}
            eventTitle={state.event?.title ?? null}
            timeline={timeline}
            playbackT={isPlaying ? playback.t : null}
          />
        </div>
        <div className="scene-vignette" aria-hidden="true" />

        <header className="cockpit-header opening-chrome">
          <div className="atlas-brand" aria-label="Atlas Capital">
            <span className="atlas-glyph" aria-hidden="true"><i /></span>
            <span className="atlas-wordmark"><strong>Atlas</strong><em>Capital</em></span>
          </div>
          <StageRail
            steps={DISPLAY_STEPS}
            activeIndex={presentation.activeIndex}
            completed={presentation.completed}
          />
          <div className="cockpit-actions">
            <button
              type="button"
              className="command-status"
              onClick={() => openDrawer("activity")}
              aria-label="Open command details"
            >
              <span className={error || state.lastDenial ? "is-alert" : ""} />
              <i>{mode}</i>
              <b>{utc.slice(11, 19)}</b>
            </button>
            <button
              type="button"
              className="primary-command"
              disabled={presentation.ctaDisabled}
              onClick={handlePrimaryAction}
            >
              <span>{presentation.ctaLabel}</span>
              <svg viewBox="0 0 22 22" aria-hidden="true"><path d="M6 3.5 17 11 6 18.5Z" /></svg>
            </button>
          </div>
        </header>

        <div className="cockpit-sponsor-rail opening-chrome">
          <SponsorRail
            tape={state.tape}
            sources={state.telemetry.sources}
            currentStage={isPlaying ? "SIMULATE" : state.stage}
            running={running || isPlaying}
          />
        </div>

        {error && (
          <div className="cockpit-alert opening-chrome" role="alert">
            <span>System alert</span>
            <p>{error}</p>
            <button type="button" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        <EventCard event={state.event} phase={phase} onSubmit={handleScreen} />
        <PnlCard state={state} onOpen={() => openDrawer("fund")} />
        <PartnerDock
          telemetry={state.telemetry}
          onOpen={() => openDrawer("systems")}
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

      <CommandDrawer
        open={drawerOpen}
        activeTab={drawerTab}
        state={state}
        phase={phase}
        selectedOutcomes={selectedOutcomes}
        selectedProposals={selectedProposals}
        onTabChange={setDrawerTab}
        onClose={closeDrawer}
        onOutcomeChange={setSelectedOutcomes}
        onProposalChange={setSelectedProposals}
        onRun={handleSimulate}
        onExecute={handleExecute}
        onNewScenario={handleNewScenario}
      />
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
