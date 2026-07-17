"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import type {
  FundState,
  LiveTransportSnapshot,
  OrchestratorEvent,
  PipelineStage,
  WorldModel,
} from "@/lib/types";
import { resolveRegion } from "@/lib/live-transport/regions";
import { AppHeader } from "@/components/AppHeader";
import { StageRail } from "@/components/StageRail";
import { PortfolioExposurePanel } from "@/components/PortfolioExposurePanel";
import { ContextPanel } from "@/components/ContextPanel";
import { ScenarioComposer } from "@/components/ScenarioComposer";
import { ScenarioTimeline } from "@/components/ScenarioTimeline";
import { TelemetryStrip } from "@/components/TelemetryStrip";
import { ObservedTrafficPanel } from "@/components/ObservedTrafficPanel";
import type { TransportLayerToggles } from "@/components/GlobeView";

const GlobeView = dynamic(() => import("@/components/GlobeView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center font-mono text-[11px] tracking-[0.15em] text-atlas-muted uppercase">
      ChainAlpha · initializing globe…
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

const SECONDARY_SHOCK_ID = "japan-export-restriction";
const DEFAULT_SCENARIO = "taiwan-earthquake";

function idleState(mode: "live" | "replay"): FundState {
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
    businessPhase: 0,
    pnlUsd: 0,
    transportBaseline: null,
    exposedTransportAssets: [],
    transportImpact: null,
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
  };
}

function CommandCenterInner() {
  const searchParams = useSearchParams();
  const replayParam = searchParams.get("replay") === "1";
  const [mode] = useState<"live" | "replay">(replayParam ? "replay" : "live");

  const [state, setState] = useState<FundState>(() => idleState(mode));
  const [running, setRunning] = useState(false);
  const [hasCompletedRun, setHasCompletedRun] = useState(false);
  const [worldModel, setWorldModel] = useState<WorldModel | null>(null);
  const [utc, setUtc] = useState("");

  // Selectors + composer input
  const [industry, setIndustry] = useState("Semiconductors");
  const [company, setCompany] = useState("NVIDIA");
  const [horizonWeeks, setHorizonWeeks] = useState(12);
  const [scenarioId, setScenarioId] = useState(DEFAULT_SCENARIO);
  const [prompt, setPrompt] = useState("");

  // ─── Live-transport (observed) layer ───
  const [snapshot, setSnapshot] = useState<LiveTransportSnapshot | null>(null);
  const [layers, setLayers] = useState<TransportLayerToggles>({
    vessels: true,
    aircraft: true,
    routes: true,
    labels: false,
  });
  const onToggleLayer = useCallback(
    (key: keyof TransportLayerToggles, value: boolean) =>
      setLayers((prev) => ({ ...prev, [key]: value })),
    []
  );

  // Region follows the selected scenario (Taiwan by default, Red Sea when chosen).
  const regionId = scenarioId === "red-sea" ? "red-sea" : "taiwan";
  const region = useMemo(() => resolveRegion(regionId), [regionId]);

  const esRef = useRef<EventSource | null>(null);

  // Fetch the world graph for the active worldModel id.
  useEffect(() => {
    const id = state.worldModelId || "semiconductors";
    let cancelled = false;
    fetch(`/api/world-model?worldModelId=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((data: WorldModel) => {
        if (!cancelled) setWorldModel(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [state.worldModelId]);

  // UTC clock
  useEffect(() => {
    const tick = () =>
      setUtc(new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC"));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Cleanup any open stream on unmount
  useEffect(() => {
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, []);

  // Poll the observed live-transport snapshot on mount + every ~15s (server-cached;
  // the browser never contacts providers directly). Replay follows the app mode.
  useEffect(() => {
    let cancelled = false;
    const replayFlag = mode === "replay" || replayParam ? "1" : "0";
    const load = () => {
      fetch(
        `/api/live-transport?region=${encodeURIComponent(regionId)}&replay=${replayFlag}`
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((data: LiveTransportSnapshot | null) => {
          if (!cancelled && data) setSnapshot(data);
        })
        .catch(() => undefined);
    };
    load();
    const id = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [regionId, mode, replayParam]);

  const openStream = useCallback(
    (extra: Record<string, string> = {}) => {
      esRef.current?.close();
      setRunning(true);
      setHasCompletedRun(false);
      setState((prev) => ({ ...idleState(mode), worldModelId: prev.worldModelId }));

      const params = new URLSearchParams({
        replay: mode === "replay" || replayParam ? "1" : "0",
        scenarioId,
        industry,
        company,
        horizonDays: String(horizonWeeks * 7),
        prompt,
        region: regionId,
        ...extra,
      });

      const es = new EventSource(`/api/simulate?${params.toString()}`);
      esRef.current = es;

      es.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as OrchestratorEvent;
          if (event.type === "state" || event.type === "done") {
            setState(event.payload as FundState);
            if (event.type === "done") {
              setRunning(false);
              setHasCompletedRun(true);
              es.close();
              esRef.current = null;
            }
          } else if (event.type === "stage") {
            setState((prev) => ({ ...prev, stage: event.payload as PipelineStage }));
          } else if (event.type === "error") {
            setRunning(false);
            es.close();
            esRef.current = null;
          }
        } catch {
          /* ignore malformed frame */
        }
      };

      es.onerror = () => {
        setRunning(false);
        es.close();
        esRef.current = null;
      };
    },
    [mode, replayParam, scenarioId, industry, company, horizonWeeks, prompt, regionId]
  );

  const runSimulation = useCallback(() => {
    if (running) return;
    openStream();
  }, [running, openStream]);

  const injectShock = useCallback(() => {
    if (running || !hasCompletedRun) return;
    openStream({ secondaryShockId: SECONDARY_SHOCK_ID });
  }, [running, hasCompletedRun, openStream]);

  const resetAll = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setRunning(false);
    setHasCompletedRun(false);
    setState((prev) => ({ ...idleState(mode), worldModelId: prev.worldModelId }));
    setPrompt("");
  }, [mode]);

  const activeStageIndex = useMemo(() => {
    if (state.stage === "IDLE" || state.stage === "ERROR") return -1;
    if (state.stage === "DONE") return STAGES.length;
    return STAGES.indexOf(state.stage);
  }, [state.stage]);

  const isIdle = state.stage === "IDLE" && !running;
  const timelineActive = !isIdle || state.tape.length > 0;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-atlas-bg text-atlas-text">
      <AppHeader
        industry={industry}
        company={company}
        horizonWeeks={horizonWeeks}
        onIndustry={setIndustry}
        onCompany={setCompany}
        onHorizon={setHorizonWeeks}
        mode={mode}
        clearance={state.clearance}
        running={running}
        utc={utc}
        disabled={running}
      />

      <StageRail stages={STAGES} activeIndex={activeStageIndex} current={state.stage} />

      <div className="grid min-h-0 flex-1 grid-cols-12">
        {/* LEFT — portfolio exposure */}
        <aside className="col-span-3 flex min-h-0 flex-col border-r border-atlas-hairline 2xl:col-span-2">
          <PortfolioExposurePanel portfolio={state.portfolio} pnlUsd={state.pnlUsd} />
        </aside>

        {/* CENTER — globe */}
        <main className="relative col-span-6 min-h-0 2xl:col-span-7">
          {isIdle && (
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center">
              <p className="font-mono text-[12px] tracking-[0.22em] text-atlas-muted uppercase">
                ChainAlpha — awaiting scenario
              </p>
              <p className="mt-2 max-w-sm text-center font-sans text-[13px] text-atlas-dim">
                Describe a supply-chain disruption below, or pick a curated scenario,
                then press <span className="text-atlas-cyan">Run</span>.
              </p>
            </div>
          )}

          <GlobeView
            worldModel={worldModel}
            epicenter={state.scenario?.epicenterNode ?? null}
            nodeStatuses={state.nodeStatuses}
            edgeStatuses={state.edgeStatuses}
            propagationOrder={state.propagationOrder}
            propagationEvents={state.propagationEvents}
            affectedNodes={state.affectedNodes}
            affectedEdges={state.affectedEdges}
            stage={state.stage}
            scenarioTitle={state.scenario?.title ?? null}
            vessels={snapshot?.vessels ?? []}
            aircraft={snapshot?.aircraft ?? []}
            exposedAssetIds={state.exposedTransportAssets}
            layers={layers}
          />

          {/* Observed live-transport overlay (top-right of the globe) */}
          <div className="pointer-events-auto absolute right-3 top-3 z-20">
            <ObservedTrafficPanel
              snapshot={snapshot}
              regionLabel={region.label}
              layers={layers}
              onToggle={onToggleLayer}
              loading={!snapshot}
            />
          </div>

          {/* Baseline-captured note (streamed baseline, immutable during the run) */}
          {state.transportBaseline && (
            <div className="pointer-events-none absolute inset-x-0 bottom-[6.5rem] z-20 flex justify-center px-4">
              <div className="rounded-sm border border-atlas-cyan/30 bg-atlas-bg/85 px-3 py-1 font-mono text-[10px] tracking-[0.06em] text-atlas-muted backdrop-blur-sm">
                <span className="text-atlas-cyan">Baseline captured</span>
                <span className="text-atlas-dim"> — </span>
                {state.transportBaseline.vessels.length} vessels ·{" "}
                {state.transportBaseline.aircraft.length} aircraft ·{" "}
                {state.transportBaseline.capturedAt
                  .replace("T", " ")
                  .replace(/\.\d+Z$/, " UTC")
                  .replace(/Z$/, " UTC")}
              </div>
            </div>
          )}

          {/* Command input near bottom-center of the globe */}
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
            <ScenarioComposer
              prompt={prompt}
              onPromptChange={setPrompt}
              scenarioId={scenarioId}
              onScenarioChange={setScenarioId}
              onRun={runSimulation}
              onReset={resetAll}
              onInjectShock={injectShock}
              running={running}
              canInjectShock={hasCompletedRun && !state.secondaryShockApplied}
            />
          </div>
        </main>

        {/* RIGHT — contextual tabbed panel */}
        <aside className="col-span-3 flex min-h-0 flex-col border-l border-atlas-hairline">
          <ContextPanel state={state} promptText={prompt} idle={isIdle} />
        </aside>
      </div>

      <ScenarioTimeline businessPhase={state.businessPhase} active={timelineActive} />
      <TelemetryStrip telemetry={state.telemetry} stage={state.stage} />
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center font-mono text-[11px] tracking-[0.15em] text-atlas-muted uppercase">
          Loading ChainAlpha…
        </div>
      }
    >
      <CommandCenterInner />
    </Suspense>
  );
}
