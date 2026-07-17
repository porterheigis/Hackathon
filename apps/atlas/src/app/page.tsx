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
import {
  DISPLAY_STEPS,
  getPresentationState,
  type DrawerTab,
  type Phase,
} from "@/lib/presentation";
import { emptyFundState } from "@/lib/store-client";
import { usePlayback } from "@/lib/usePlayback";
import { StageRail } from "@/components/StageRail";
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("activity");

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
      setTacticalOverride((prev) => (prev ? false : prev));
      return;
    }
    const t = playback.t;
    const cutStart = timeline.events.find((e) => e.kind === "tactical_cutaway");
    const cutEnd = timeline.events.find((e) => e.kind === "tactical_end");
    if (!cutStart || !cutEnd) return;
    const next = t >= cutStart.t && t < cutEnd.t;
    setTacticalOverride((prev) => (prev === next ? prev : next));
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
    setDrawerOpen(false);
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
    setDrawerOpen(false);

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
    setDrawerOpen(false);

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
  const showTactical =
    tacticalOverride || (state.viewport === "tactical" && phase === "simulating");

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
        </div>
        <div className="scene-vignette" aria-hidden="true" />
        <div className="scene-grid opening-chrome" aria-hidden="true" />

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

        {error && (
          <div className="cockpit-alert opening-chrome" role="alert">
            <span>System alert</span>
            <p>{error}</p>
            <button type="button" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        <div className="opening-panel opening-panel-event">
          <EventCard event={state.event} phase={phase} onSubmit={handleScreen} />
        </div>
        <div className="opening-panel opening-panel-pnl">
          <PnlCard state={state} onOpen={() => openDrawer("fund")} />
        </div>
        <div className="opening-panel opening-panel-dock">
          <PartnerDock telemetry={state.telemetry} onOpen={() => openDrawer("systems")} />
        </div>

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
