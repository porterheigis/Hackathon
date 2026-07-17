"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { makeAssetMesh } from "@/lib/globe-glyphs";
import {
  sampleAssetHeading,
  sampleAssetOpacity,
  sampleAssetPosition,
  sampleCamera,
} from "@/lib/timeline";
import type {
  PipelineStage,
  PriceTicker,
  SimTimeline,
  TimelineAsset,
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
}

interface ArcDatum {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string[];
  stroke: number;
  id: string;
  dashLength: number;
  dashGap: number;
  dashTime: number;
  altitude: number;
  dashInitialGap: number;
}

interface PointDatum {
  lat: number;
  lng: number;
  size: number;
  color: string;
  label: string;
  id: string;
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

interface ObjectDatum {
  id: string;
  lat: number;
  lng: number;
  alt: number;
  kind: TimelineAsset["kind"];
  label: string;
  heading: number;
  opacity: number;
}

const BLUE_MARBLE =
  "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg";
const TOPOLOGY =
  "https://unpkg.com/three-globe/example/img/earth-topology.png";

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

function nodeRevealWeight(
  id: string,
  order: string[],
  t: number,
  epicenter: string | null
): number {
  if (id === epicenter) return 1;
  const idx = order.indexOf(id);
  if (idx < 0) return 0;
  const start = 0.02 + (idx / Math.max(order.length, 1)) * 0.4;
  return smoothstep(start, start + 0.08, t);
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
}: GlobeViewProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 600, h: 600 });
  const [propStep, setPropStep] = useState(0);
  const [globeReady, setGlobeReady] = useState(false);
  const tickerEls = useRef(new Map<string, HTMLDivElement>());
  const autoRotateRamp = useRef(0.25);
  const lastCamKey = useRef("");
  const playingRef = useRef(playing);
  const timelineRef = useRef(timeline);
  const epicenterRef = useRef(epicenter);
  const playbackTRef = useRef(playbackT);
  const visibleRef = useRef(visible);

  playingRef.current = playing;
  timelineRef.current = timeline;
  epicenterRef.current = epicenter;
  playbackTRef.current = playbackT;
  visibleRef.current = visible;

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
  const order = propagationOrder.length ? propagationOrder : affectedNodes;

  const visibleNodes = useMemo(() => {
    if (t != null && timeline) {
      const n = revealCount(t, Math.max(order.length, 1));
      return new Set(order.slice(0, n));
    }
    if (!order.length) return new Set<string>();
    return new Set(order.slice(0, Math.max(1, propStep)));
  }, [order, propStep, t, timeline]);

  const laneFrozen = t != null ? t >= 0.05 : stage !== "IDLE";
  const rerouteMix =
    t != null ? smoothstep(0.42, 0.52, t) : stage === "PROPOSE" ? 1 : 0;
  const wantsAir = selectedOutcomes.includes("air_travel");
  const airThinning =
    wantsAir &&
    (playing ||
      stage === "SIMULATE" ||
      stage === "PROPOSE" ||
      stage === "AWAITING_APPROVAL");

  const points: PointDatum[] = useMemo(() => {
    if (!worldModel) return [];
    return worldModel.nodes
      .filter(
        (n) =>
          n.type === "chokepoint" ||
          n.type === "port" ||
          n.type === "hub" ||
          n.type === "refinery"
      )
      .map((n) => {
        const isEpi = n.id === epicenter;
        let weight = 0;
        if (t != null) {
          weight = nodeRevealWeight(n.id, order, t, epicenter);
        } else {
          weight = visibleNodes.has(n.id) || isEpi ? 1 : 0;
        }
        const size = isEpi
          ? 0.55
          : 0.12 + weight * 0.22;
        const color = isEpi
          ? RED
          : weight > 0.5
            ? AMBER
            : weight > 0
              ? `rgba(255,180,84,${0.35 + weight * 0.5})`
              : "rgba(255,255,255,0.22)";
        return {
          id: n.id,
          lat: n.lat,
          lng: n.lng,
          size,
          color,
          label: n.name,
        };
      });
  }, [worldModel, visibleNodes, epicenter, t, order]);

  const objectsData: ObjectDatum[] = useMemo(() => {
    if (!timeline || t == null || !visible) return [];
    const out: ObjectDatum[] = [];
    for (const asset of timeline.assets) {
      const opacity = sampleAssetOpacity(asset, t);
      if (opacity <= 0) continue;
      const pos = sampleAssetPosition(asset, t);
      if (!pos) continue;
      out.push({
        id: asset.id,
        lat: pos.lat,
        lng: pos.lng,
        alt: pos.alt ?? (asset.kind === "plane" ? 0.22 : 0.012),
        kind: asset.kind,
        label: asset.label ?? asset.kind,
        heading: sampleAssetHeading(asset, t),
        opacity,
      });
    }
    return out;
  }, [timeline, t, visible]);

  const objectThreeObject = useCallback((d: object) => {
    const data = d as ObjectDatum;
    const mesh = makeAssetMesh(data.kind) as {
      traverse?: (fn: (o: { material?: { opacity: number; transparent: boolean } }) => void) => void;
      rotation?: { y: number };
      material?: { opacity: number; transparent: boolean };
    };
    const applyOpacity = (opacity: number) => {
      if (mesh.traverse) {
        mesh.traverse((o) => {
          if (o.material) {
            o.material.transparent = true;
            o.material.opacity = opacity;
          }
        });
      } else if (mesh.material) {
        mesh.material.transparent = true;
        mesh.material.opacity = opacity;
      }
    };
    applyOpacity(data.opacity);
    return mesh;
  }, []);

  const arcs: ArcDatum[] = useMemo(() => {
    if (!worldModel) return [];
    return worldModel.edges
      .map((e) => {
        const a = nodeMap.get(e.from);
        const b = nodeMap.get(e.to);
        if (!a || !b) return null;
        const isAir = e.lane_type === "air";
        const disrupted = disruptedEdges.includes(e.id);
        const hot =
          (affectedEdges.includes(e.id) || disrupted) &&
          (visibleNodes.has(e.from) || visibleNodes.has(e.to) || disrupted);
        const traffic = e.traffic ?? 0.5;
        const frozen = disrupted && hot && laneFrozen;

        // Grow-in: cold arcs start with gap; hot arcs fill
        let dashInitialGap = hot ? 0 : 0.35;
        if (t != null && hot) {
          const edgeIdx = Math.max(
            order.indexOf(e.from),
            order.indexOf(e.to),
            0
          );
          const start = 0.04 + (edgeIdx / Math.max(order.length, 1)) * 0.35;
          dashInitialGap = 1 - smoothstep(start, start + 0.1, t);
        }

        let color: string[] = [
          "rgba(255,255,255,0.07)",
          "rgba(255,255,255,0.07)",
        ];
        let stroke = isAir ? 0.25 : 0.35;
        let dashTime =
          stage === "IDLE" && !playing ? 0 : isAir ? 1800 : 2800;
        let altitude = isAir ? 0.25 : 0.12;

        if (hot && rerouteMix > 0) {
          const g = rerouteMix;
          altitude = isAir
            ? 0.25 + g * 0.1
            : 0.12 + g * 0.1;
          color = [
            `rgba(47,214,130,${0.25 + g * 0.2})`,
            `rgba(47,214,130,${0.45 + g * 0.35})`,
          ];
          stroke = 0.5 + g * 0.45;
          dashTime = Math.round(2800 - g * 600);
        } else if (hot) {
          if (isAir && airThinning) {
            color = [
              `rgba(57,211,245,0.18)`,
              `rgba(57,211,245,0.4)`,
            ];
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
          color = [
            "rgba(57,211,245,0.1)",
            "rgba(57,211,245,0.18)",
          ];
        }

        return {
          id: e.id,
          startLat: a.lat,
          startLng: a.lng,
          endLat: b.lat,
          endLng: b.lng,
          color,
          stroke,
          dashLength: isAir ? 0.15 : 0.35 * traffic,
          dashGap: isAir ? 0.08 : 0.2,
          dashTime,
          altitude,
          dashInitialGap,
        };
      })
      .filter(Boolean) as ArcDatum[];
  }, [
    worldModel,
    nodeMap,
    affectedEdges,
    disruptedEdges,
    visibleNodes,
    stage,
    airThinning,
    laneFrozen,
    playing,
    t,
    rerouteMix,
    order,
  ]);

  const rings: RingDatum[] = useMemo(() => {
    if (!epicenter || !nodeMap.has(epicenter)) return [];
    if (stage === "IDLE" && !playing) return [];
    const n = nodeMap.get(epicenter)!;
    const ringT = t ?? 0.2;
    if (playing && ringT >= 0.55) return [];
    const fade = playing ? 1 - smoothstep(0.35, 0.55, ringT) : 1;
    if (fade <= 0.05) return [];
    return [
      {
        lat: n.lat,
        lng: n.lng,
        maxR: 3.5,
        propagationSpeed: 2.2,
        repeatPeriod: 1400,
        color: `rgba(255,92,92,${0.65 * fade})`,
      },
    ];
  }, [epicenter, nodeMap, stage, playing, t]);

  const htmlEls: HtmlDatum[] = useMemo(() => {
    if (!tickers.length || !visible) return [];
    if (playing && t != null) {
      return tickers
        .map((tk, i) => {
          const appear = 0.72 + (i / Math.max(tickers.length, 1)) * 0.22;
          if (t < appear) return null;
          return {
            id: tk.node_id || `${tk.label}-${i}`,
            lat: tk.lat,
            lng: tk.lng,
            label: tk.label,
            delta: tk.delta_pct,
          };
        })
        .filter(Boolean) as HtmlDatum[];
    }
    if (
      stage !== "SIMULATE" &&
      stage !== "PROPOSE" &&
      stage !== "AWAITING_APPROVAL" &&
      stage !== "DONE"
    )
      return [];
    return tickers
      .slice(0, Math.max(1, Math.floor(propStep / 2) + 1))
      .map((tk, i) => ({
        id: tk.node_id || `${tk.label}-${i}`,
        lat: tk.lat,
        lng: tk.lng,
        label: tk.label,
        delta: tk.delta_pct,
      }));
  }, [tickers, stage, propStep, playing, t, visible]);

  // Continuous camera during playback (throttled via React t is ok at 20fps for POV;
  // we also push every frame while playing for smoother feel)
  useEffect(() => {
    if (!globeReady || !globeRef.current) return;
    if (!playing || t == null || !epicenter || !nodeMap.has(epicenter)) return;
    if (!visible) return;
    const n = nodeMap.get(epicenter)!;
    let raf = 0;
    let lastPush = 0;
    const loop = (now: number) => {
      if (!playingRef.current || !visibleRef.current) return;
      const g = globeRef.current;
      const epiId = epicenterRef.current;
      if (!g || !epiId || !nodeMap.has(epiId)) return;
      const epi = nodeMap.get(epiId)!;
      const curT = playbackTRef.current ?? t;
      if (now - lastPush > 32) {
        lastPush = now;
        const cam = sampleCamera(curT, epi);
        const key = `${cam.altitude.toFixed(2)}:${cam.lng.toFixed(1)}`;
        if (key !== lastCamKey.current) {
          lastCamKey.current = key;
          g.pointOfView(cam, 80);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    // Initial fly
    const cam0 = sampleCamera(t, n);
    globeRef.current.pointOfView(cam0, 600);
    lastCamKey.current = `${cam0.altitude.toFixed(2)}:${cam0.lng.toFixed(1)}`;
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, globeReady, epicenter, nodeMap, visible, t]);

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

  // Align to epicenter before tactical cutaway (when becoming hidden)
  useEffect(() => {
    if (visible || !globeRef.current || !epicenter || !nodeMap.has(epicenter))
      return;
    const n = nodeMap.get(epicenter)!;
    globeRef.current.pointOfView(
      { lat: n.lat, lng: n.lng, altitude: 0.85 },
      400
    );
  }, [visible, epicenter, nodeMap]);

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
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 500ms ease-out",
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
        pointsData={visible ? points : []}
        pointAltitude={0.015}
        pointRadius="size"
        pointColor="color"
        pointLabel={(d) => (d as PointDatum).label}
        arcsData={visible ? arcs : []}
        arcColor="color"
        arcStroke="stroke"
        arcAltitude="altitude"
        arcDashLength="dashLength"
        arcDashGap="dashGap"
        arcDashAnimateTime="dashTime"
        arcDashInitialGap="dashInitialGap"
        ringsData={visible ? rings : []}
        ringColor={(d) => (d as RingDatum).color ?? "rgba(255,92,92,0.65)"}
        ringMaxRadius="maxR"
        ringPropagationSpeed="propagationSpeed"
        ringRepeatPeriod="repeatPeriod"
        objectsData={visible ? objectsData : []}
        objectLat="lat"
        objectLng="lng"
        objectAltitude="alt"
        objectThreeObject={objectThreeObject}
        objectLabel={(d) => (d as ObjectDatum).label}
        objectRotation={(d) => ({
          y: (d as ObjectDatum).heading,
        })}
        htmlElementsData={visible ? htmlEls : []}
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
