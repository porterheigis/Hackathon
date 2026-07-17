"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import {
  disposeAssetMesh,
  makeAssetIcon,
  makeLayerGroup,
  poseAssetMesh,
} from "@/lib/globe-glyphs";
import {
  cutWindow,
  sampleAssetOpacity,
  sampleAssetPosition,
  sampleCamera,
} from "@/lib/timeline";
import type {
  PipelineStage,
  PriceTicker,
  SimTimeline,
  WorldModel,
} from "@/lib/types";

interface GlobeViewProps {
  worldModel: WorldModel | null;
  epicenter: string | null;
  affectedNodes: string[];
  affectedEdges: string[];
  disruptedEdges: string[];
  selectedOutcomes: string[];
  propagationOrder: string[];
  tickers?: PriceTicker[];
  stage: PipelineStage;
  eventTitle: string | null;
  visible?: boolean;
  playbackT?: number | null;
  timeline?: SimTimeline | null;
  playing?: boolean;
  /** Live 60fps playback t for rAF consumers (camera + props) */
  getT?: () => number;
}

interface ArcDatum {
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string[];
  stroke: number;
  dashLength: number;
  dashGap: number;
  dashTime: number;
  altitude: number;
  dashInitialGap: number;
  /** cache of last applied style, to detect changes cheaply */
  styleKey: string;
}

interface PointDatum {
  id: string;
  lat: number;
  lng: number;
  size: number;
  color: string;
  label: string;
  styleKey: string;
}

interface RingDatum {
  lat: number;
  lng: number;
  maxR: number;
  propagationSpeed: number;
  repeatPeriod: number;
  color: string;
}

interface HtmlDatum {
  id: string;
  lat: number;
  lng: number;
  label: string;
  delta: number;
}

type AssetMesh = ReturnType<typeof makeAssetIcon>;

const BLUE_MARBLE = "/earth-night.jpg";
const TOPOLOGY = "/earth-topology.png";

const AMBER = "#ffb454";
const RED = "#ff5c5c";
const GREEN = "#2fd682";
const BG = "#0a0e14";

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function revealCount(t: number, total: number): number {
  if (total <= 0) return 0;
  // Soft cascade: reveal over first 45% of playback
  const u = smoothstep(0.02, 0.45, t);
  return Math.max(1, Math.ceil(u * total));
}

export default function GlobeView({
  worldModel,
  epicenter,
  affectedNodes,
  affectedEdges,
  disruptedEdges,
  selectedOutcomes,
  propagationOrder,
  tickers = [],
  stage,
  eventTitle,
  visible = true,
  playbackT = null,
  timeline = null,
  playing = false,
  getT,
}: GlobeViewProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 600, h: 600 });
  const [propStep, setPropStep] = useState(0);
  const [globeReady, setGlobeReady] = useState(false);
  const tickerEls = useRef(new Map<string, HTMLDivElement>());
  const autoRotateRamp = useRef(0.25);
  const lastCamKey = useRef("");

  const playbackTRef = useRef(playbackT);
  playbackTRef.current = playbackT;
  const getTRef = useRef(getT);
  getTRef.current = getT;
  const liveT = useCallback(() => {
    const fn = getTRef.current;
    if (fn) return fn();
    return playbackTRef.current ?? 0;
  }, []);

  // Stable datum stores — objects are built once per worldModel and then
  // MUTATED in place; versions bump so memos hand three-globe the same
  // object identities and it tweens style changes instead of exit+enter.
  const arcMapRef = useRef(new Map<string, ArcDatum>());
  const pointMapRef = useRef(new Map<string, PointDatum>());
  const [arcVersion, setArcVersion] = useState(0);
  const [pointVersion, setPointVersion] = useState(0);

  // Debounced resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const apply = (width: number, height: number) => {
      setDims({ w: Math.max(200, width), h: Math.max(200, height) });
    };
    apply(el.clientWidth, el.clientHeight);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => apply(width, height), 120);
    });
    ro.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  // Pixel ratio + damping once ready
  useEffect(() => {
    if (!globeReady) return;
    const g = globeRef.current;
    if (!g) return;
    try {
      const renderer = g.renderer();
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    } catch {
      /* */
    }
    g.controls().enableDamping = true;
    g.controls().dampingFactor = 0.08;
  }, [globeReady]);

  // Auto-rotate ramp down when leaving idle
  useEffect(() => {
    const g = globeRef.current;
    if (!g || !globeReady) return;
    const wantIdle = stage === "IDLE" && !playing;
    if (wantIdle) {
      autoRotateRamp.current = 0.25;
      g.controls().autoRotate = true;
      g.controls().autoRotateSpeed = 0.25;
      return;
    }
    // Ramp down over ~300ms
    const start = performance.now();
    const from = autoRotateRamp.current;
    let raf = 0;
    const step = (now: number) => {
      const u = Math.min(1, (now - start) / 300);
      const speed = from * (1 - u);
      autoRotateRamp.current = speed;
      const globe = globeRef.current;
      if (!globe) return;
      if (speed < 0.01) {
        globe.controls().autoRotate = false;
        globe.controls().autoRotateSpeed = 0;
        return;
      }
      globe.controls().autoRotate = true;
      globe.controls().autoRotateSpeed = speed;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [stage, playing, globeReady]);

  // Non-playback cascade reveal
  useEffect(() => {
    if (playing && playbackT != null) return;
    if (stage !== "SIMULATE" && stage !== "MODEL" && stage !== "PROPOSE") {
      setPropStep(propagationOrder.length || affectedNodes.length);
      return;
    }
    setPropStep(0);
    const total = Math.max(propagationOrder.length, affectedNodes.length, 1);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setPropStep(i);
      if (i >= total) clearInterval(id);
    }, 160);
    return () => clearInterval(id);
  }, [stage, propagationOrder, affectedNodes, playing, playbackT]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, { lat: number; lng: number; name: string }>();
    for (const n of worldModel?.nodes ?? []) {
      m.set(n.id, { lat: n.lat, lng: n.lng, name: n.name });
    }
    return m;
  }, [worldModel]);

  const t = playing && playbackT != null ? playbackT : null;
  const order = useMemo(
    () => (propagationOrder.length ? propagationOrder : affectedNodes),
    [propagationOrder, affectedNodes]
  );

  // ---- Discrete style drivers (integers/booleans only — never raw t) ----
  const revealedCount =
    t != null
      ? revealCount(t, Math.max(order.length, 1))
      : Math.max(1, propStep);
  const laneFrozen = t != null ? t >= 0.05 : stage !== "IDLE";
  const rerouteOn =
    t != null
      ? smoothstep(0.42, 0.52, t) > 0.5
      : stage === "PROPOSE";
  const wantsAir = selectedOutcomes.includes("air_travel");
  const airThinning =
    wantsAir &&
    (playing ||
      stage === "SIMULATE" ||
      stage === "PROPOSE" ||
      stage === "AWAITING_APPROVAL");
  const ringPhase: "on" | "fading" | "off" =
    t == null ? "on" : t < 0.35 ? "on" : t < 0.55 ? "fading" : "off";
  const visibleTickerCount =
    t != null
      ? tickers.filter(
          (_, i) => t >= 0.72 + (i / Math.max(tickers.length, 1)) * 0.22
        ).length
      : stage === "SIMULATE" ||
          stage === "PROPOSE" ||
          stage === "AWAITING_APPROVAL" ||
          stage === "DONE"
        ? Math.min(tickers.length, Math.max(1, Math.floor(propStep / 2) + 1))
        : 0;

  // ---- Build stable datums ONCE per world model ----
  useEffect(() => {
    const arcMap = arcMapRef.current;
    const pointMap = pointMapRef.current;
    arcMap.clear();
    pointMap.clear();
    if (worldModel) {
      const nm = new Map(worldModel.nodes.map((n) => [n.id, n]));
      for (const e of worldModel.edges) {
        const a = nm.get(e.from);
        const b = nm.get(e.to);
        if (!a || !b) continue;
        const isAir = e.lane_type === "air";
        arcMap.set(e.id, {
          id: e.id,
          startLat: a.lat,
          startLng: a.lng,
          endLat: b.lat,
          endLng: b.lng,
          color: ["rgba(255,255,255,0.07)", "rgba(255,255,255,0.07)"],
          stroke: isAir ? 0.25 : 0.35,
          dashLength: isAir ? 0.15 : 0.35 * (e.traffic ?? 0.5),
          dashGap: isAir ? 0.08 : 0.2,
          dashTime: 0,
          altitude: isAir ? 0.25 : 0.12,
          dashInitialGap: 0,
          styleKey: "",
        });
      }
      for (const n of worldModel.nodes) {
        if (
          n.type !== "chokepoint" &&
          n.type !== "port" &&
          n.type !== "hub" &&
          n.type !== "refinery"
        )
          continue;
        pointMap.set(n.id, {
          id: n.id,
          lat: n.lat,
          lng: n.lng,
          size: 0.12,
          color: "rgba(255,255,255,0.22)",
          label: n.name,
          styleKey: "",
        });
      }
    }
    setArcVersion((v) => v + 1);
    setPointVersion((v) => v + 1);
  }, [worldModel]);

  // ---- Style pass: mutate datums in place when discrete state changes ----
  useEffect(() => {
    if (!worldModel) return;
    const revealed = new Set(order.slice(0, revealedCount));
    if (epicenter) revealed.add(epicenter);

    let pointChanged = false;
    for (const p of pointMapRef.current.values()) {
      const isEpi = p.id === epicenter;
      const on = revealed.has(p.id);
      const key = `${isEpi ? "e" : on ? "1" : "0"}`;
      if (key === p.styleKey) continue;
      p.styleKey = key;
      p.size = isEpi ? 0.55 : on ? 0.34 : 0.12;
      p.color = isEpi ? RED : on ? AMBER : "rgba(255,255,255,0.22)";
      pointChanged = true;
    }
    if (pointChanged) setPointVersion((v) => v + 1);

    const disrupted = new Set(disruptedEdges);
    const affected = new Set(affectedEdges);
    let arcChanged = false;
    for (const e of worldModel.edges) {
      const d = arcMapRef.current.get(e.id);
      if (!d) continue;
      const isAir = e.lane_type === "air";
      const isDisrupted = disrupted.has(e.id);
      const hot =
        (affected.has(e.id) || isDisrupted) &&
        (revealed.has(e.from) || revealed.has(e.to) || isDisrupted);
      const frozen = isDisrupted && hot && laneFrozen;
      const idleDash = stage === "IDLE" && !playing;

      const key = [
        hot ? 1 : 0,
        frozen ? 1 : 0,
        rerouteOn && hot ? 1 : 0,
        airThinning && isAir ? 1 : 0,
        idleDash ? 1 : 0,
      ].join("");
      if (key === d.styleKey) continue;
      d.styleKey = key;

      let color: string[] = [
        "rgba(255,255,255,0.07)",
        "rgba(255,255,255,0.07)",
      ];
      let stroke = isAir ? 0.25 : 0.35;
      let dashTime = idleDash ? 0 : isAir ? 1800 : 2800;
      let altitude = isAir ? 0.25 : 0.12;

      if (hot && rerouteOn) {
        altitude = (isAir ? 0.25 : 0.12) + 0.1;
        color = ["rgba(47,214,130,0.45)", "rgba(47,214,130,0.8)"];
        stroke = 0.95;
        dashTime = 2200;
      } else if (hot) {
        if (isAir && airThinning) {
          color = ["rgba(57,211,245,0.18)", "rgba(57,211,245,0.4)"];
          stroke = 0.18;
          dashTime = 4000;
        } else if (frozen) {
          // Frozen: slow dash rather than hard stop
          color = [RED, AMBER];
          stroke = 1.35;
          dashTime = 12000;
        } else {
          color = [AMBER, RED];
          stroke = 1.05;
        }
      } else if (isAir) {
        color = ["rgba(57,211,245,0.1)", "rgba(57,211,245,0.18)"];
      }

      d.color = color;
      d.stroke = stroke;
      d.dashTime = dashTime;
      d.altitude = altitude;
      arcChanged = true;
    }
    if (arcChanged) setArcVersion((v) => v + 1);
  }, [
    worldModel,
    order,
    revealedCount,
    laneFrozen,
    rerouteOn,
    airThinning,
    stage,
    playing,
    epicenter,
    affectedEdges,
    disruptedEdges,
  ]);

  // Same object identities across renders → three-globe tweens styles
  const arcs = useMemo(
    () => Array.from(arcMapRef.current.values()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [arcVersion]
  );
  const points = useMemo(
    () => Array.from(pointMapRef.current.values()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pointVersion]
  );

  const rings: RingDatum[] = useMemo(() => {
    if (!epicenter || !nodeMap.has(epicenter)) return [];
    if (stage === "IDLE" && !playing) return [];
    if (playing && ringPhase === "off") return [];
    const n = nodeMap.get(epicenter)!;
    const alpha = playing && ringPhase === "fading" ? 0.3 : 0.65;
    return [
      {
        lat: n.lat,
        lng: n.lng,
        maxR: 3.5,
        propagationSpeed: 2.2,
        repeatPeriod: 1400,
        color: `rgba(255,92,92,${alpha})`,
      },
    ];
  }, [epicenter, nodeMap, stage, playing, ringPhase]);

  const htmlEls: HtmlDatum[] = useMemo(() => {
    if (!tickers.length || visibleTickerCount <= 0) return [];
    return tickers.slice(0, visibleTickerCount).map((tk, i) => ({
      id: tk.node_id || `${tk.label}-${i}`,
      lat: tk.lat,
      lng: tk.lng,
      label: tk.label,
      delta: tk.delta_pct,
    }));
  }, [tickers, visibleTickerCount]);

  // ---- Per-frame camera outside React ----
  useEffect(() => {
    const g = globeRef.current;
    if (!g || !globeReady) return;
    if (!playing || !visible) return;
    if (!epicenter || !nodeMap.has(epicenter)) return;
    const epi = nodeMap.get(epicenter)!;
    const cut = timeline ? cutWindow(timeline) : null;

    g.controls().enabled = false;
    let raf = 0;
    const loop = () => {
      const globe = globeRef.current;
      if (!globe) return;
      globe.pointOfView(sampleCamera(liveT(), epi, cut), 0);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      // g captured at effect setup — the globe instance is stable for the
      // component's lifetime, so re-enabling controls on it is safe.
      g.controls().enabled = true;
    };
  }, [playing, visible, globeReady, epicenter, nodeMap, timeline, liveT]);

  // ---- Asset props: direct scene management (no objectsData churn) ----
  const assetGroupRef = useRef<{ group: object; meshes: Map<string, AssetMesh> } | null>(null);

  useEffect(() => {
    const g = globeRef.current;
    if (!g || !globeReady || !timeline) return;
    // Globe.gl moves the camera (not the globe object) for POV/auto-rotate,
    // and the ThreeGlobe object sits untransformed in the scene — so a group
    // added directly to scene() stays geographically glued via getCoords.
    const scene = g.scene() as unknown as {
      add: (o: object) => void;
      remove: (o: object) => void;
    };
    const group = makeLayerGroup() as unknown as {
      add: (o: object) => void;
      remove: (o: object) => void;
    };
    const meshes = new Map<string, AssetMesh>();
    for (const asset of timeline.assets) {
      const mesh = makeAssetIcon(asset.kind);
      group.add(mesh);
      meshes.set(asset.id, mesh);
    }
    scene.add(group);
    assetGroupRef.current = { group, meshes };
    return () => {
      scene.remove(group);
      for (const mesh of meshes.values()) disposeAssetMesh(mesh);
      meshes.clear();
      assetGroupRef.current = null;
    };
  }, [globeReady, timeline]);

  // Hide the fleet during the tactical cutaway; keep it frozen after playback
  useEffect(() => {
    const entry = assetGroupRef.current;
    if (!entry) return;
    (entry.group as { visible: boolean }).visible = visible;
  }, [visible, globeReady, timeline]);

  // Per-frame prop posing
  useEffect(() => {
    const g = globeRef.current;
    if (!g || !globeReady || !timeline || !playing || !visible) return;
    let raf = 0;
    const loop = () => {
      const globe = globeRef.current;
      const entry = assetGroupRef.current;
      if (!globe || !entry) return;
      const curT = liveT();
      for (const asset of timeline.assets) {
        const mesh = entry.meshes.get(asset.id);
        if (!mesh) continue;
        const op = sampleAssetOpacity(asset, curT);
        if (op <= 0) {
          (mesh as { visible: boolean }).visible = false;
          continue;
        }
        const pos = sampleAssetPosition(asset, curT);
        if (!pos) {
          (mesh as { visible: boolean }).visible = false;
          continue;
        }
        const alt = pos.alt ?? (asset.kind === "plane" ? 0.22 : 0.012);
        const c = globe.getCoords(pos.lat, pos.lng, alt);
        const ahead =
          sampleAssetPosition(asset, Math.min(1, curT + 0.004)) ?? pos;
        const c2 = globe.getCoords(ahead.lat, ahead.lng, alt);
        poseAssetMesh(mesh, c, c2, op);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, visible, globeReady, timeline, liveT]);

  // Non-playback epicenter fly (once)
  useEffect(() => {
    if (!globeReady || !globeRef.current || playing) return;
    if (!epicenter || !nodeMap.has(epicenter)) return;
    const n = nodeMap.get(epicenter)!;
    const key = `epi:${epicenter}`;
    if (lastCamKey.current === key) return;
    lastCamKey.current = key;
    globeRef.current.pointOfView(
      { lat: n.lat, lng: n.lng, altitude: 1.6 },
      1600
    );
  }, [epicenter, nodeMap, playing, globeReady]);

  useEffect(() => {
    if (!globeReady || !globeRef.current || playing) return;
    if (stage === "PROPOSE" || stage === "AWAITING_APPROVAL") {
      globeRef.current.pointOfView({ altitude: 2.1 }, 1800);
    }
  }, [stage, playing, globeReady]);

  const htmlElement = useCallback((d: object) => {
    const data = d as HtmlDatum;
    let el = tickerEls.current.get(data.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "ticker-chip ticker-chip-enter";
      tickerEls.current.set(data.id, el);
    }
    const up = data.delta >= 0;
    el.innerHTML = `<span style="color:rgba(255,255,255,0.55)">${data.label}</span> <span style="color:${up ? RED : GREEN}">${up ? "+" : ""}${data.delta}%</span>`;
    return el;
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full bg-atlas-bg"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : "scale(1.12)",
        pointerEvents: visible ? "auto" : "none",
        transition:
          "opacity 650ms ease-out, transform 900ms cubic-bezier(0.4, 0, 0.2, 1)",
        willChange: "opacity, transform",
        zIndex: visible ? 1 : 0,
      }}
      aria-hidden={!visible}
    >
      <Globe
        ref={globeRef}
        width={dims.w}
        height={dims.h}
        backgroundColor={BG}
        globeImageUrl={BLUE_MARBLE}
        bumpImageUrl={TOPOLOGY}
        atmosphereColor="#6eb6ff"
        atmosphereAltitude={0.15}
        onGlobeReady={() => setGlobeReady(true)}
        pointsData={points}
        pointAltitude={0.015}
        pointRadius="size"
        pointColor="color"
        pointLabel={(d) => (d as PointDatum).label}
        pointsTransitionDuration={400}
        arcsData={arcs}
        arcColor="color"
        arcStroke="stroke"
        arcAltitude="altitude"
        arcDashLength="dashLength"
        arcDashGap="dashGap"
        arcDashAnimateTime="dashTime"
        arcDashInitialGap="dashInitialGap"
        arcsTransitionDuration={600}
        ringsData={rings}
        ringColor={(d: object) =>
          (d as RingDatum).color ?? "rgba(255,92,92,0.65)"
        }
        ringMaxRadius="maxR"
        ringPropagationSpeed="propagationSpeed"
        ringRepeatPeriod="repeatPeriod"
        htmlElementsData={htmlEls}
        htmlElement={htmlElement}
        htmlAltitude={0.04}
      />
      {eventTitle && stage !== "IDLE" && !playing && visible && (
        <div className="pointer-events-none absolute bottom-4 left-4 right-4">
          <p className="eyebrow">Event</p>
          <p className="mt-0.5 max-w-lg text-[13px] text-atlas-text">
            {eventTitle}
          </p>
        </div>
      )}
    </div>
  );
}
