"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import type { Object3D } from "three";
import { sampleAssetPosition } from "@/lib/timeline";
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
}

interface HtmlDatum {
  kind: "ticker" | "node";
  lat: number;
  lng: number;
  label: string;
  delta?: number;
}

interface ObjectDatum {
  id: string;
  lat: number;
  lng: number;
  alt: number;
  kind: TimelineAsset["kind"];
  label: string;
}

const BLUE_MARBLE =
  "//unpkg.com/three-globe/example/img/earth-blue-marble.jpg";
const TOPOLOGY =
  "//unpkg.com/three-globe/example/img/earth-topology.png";

function makeGlyph(kind: TimelineAsset["kind"]): Object3D {
  // Lazy-require three so Next build doesn't stall on the three graph
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const THREE = require("three") as typeof import("three");
  const group = new THREE.Group();
  const cyan = new THREE.MeshLambertMaterial({ color: "#39e7f2", emissive: "#0a5866" });
  const amber = new THREE.MeshLambertMaterial({ color: "#ff8a32", emissive: "#5a2108" });
  const red = new THREE.MeshLambertMaterial({ color: "#ff5a4f", emissive: "#50100c" });
  const steel = new THREE.MeshLambertMaterial({ color: "#c9e8ef", emissive: "#17313b" });

  if (kind === "plane") {
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.25, 5), cyan);
    body.rotation.x = Math.PI / 2;
    const wings = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.07, 0.24), cyan);
    wings.position.z = 0.05;
    group.add(body, wings);
  } else if (kind === "military") {
    group.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.43, 0), red));
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.035, 8, 28), red);
    group.add(halo);
  } else {
    const material = kind === "tanker" ? amber : steel;
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.2, 1.25), material);
    hull.position.y = -0.02;
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.27, 0.5, 4), material);
    bow.rotation.x = Math.PI / 2;
    bow.position.z = 0.82;
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.23, 0.24), steel);
    bridge.position.set(0, 0.2, -0.4);
    group.add(hull, bow, bridge);
    for (let i = 0; i < 3; i += 1) {
      const cargo = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.13, 0.22), material);
      cargo.position.set(0, 0.18, -0.08 + i * 0.25);
      group.add(cargo);
    }
  }
  group.scale.setScalar(0.55);
  return group;
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
  const lastCamMode = useRef<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: Math.max(200, width), h: Math.max(200, height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    g.controls().autoRotate = stage === "IDLE" && !playing;
    g.controls().autoRotateSpeed = 0.25;
    g.controls().enableDamping = true;
  }, [stage, playing]);

  const handleGlobeReady = useCallback(() => {
    const globe = globeRef.current;
    if (!globe) return;
    globe.pointOfView({ lat: 17, lng: 43, altitude: 1.72 }, 0);
    globe.controls().autoRotate = stage === "IDLE" && !playing;
  }, [stage, playing]);

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

  const visibleNodes = useMemo(() => {
    if (t != null && timeline) {
      const order = propagationOrder.length ? propagationOrder : affectedNodes;
      const n = Math.max(1, Math.floor(t * Math.max(order.length, 1)));
      return new Set(order.slice(0, n));
    }
    if (!propagationOrder.length && !affectedNodes.length)
      return new Set<string>();
    const order = propagationOrder.length ? propagationOrder : affectedNodes;
    return new Set(order.slice(0, Math.max(1, propStep)));
  }, [propagationOrder, affectedNodes, propStep, t, timeline]);

  const laneFrozen = t != null ? t >= 0.05 : true;
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
          n.type === "chokepoint" || n.type === "port" || n.type === "hub"
      )
      .map((n) => {
        const hit = visibleNodes.has(n.id) || n.id === epicenter;
        const isEpi = n.id === epicenter;
        return {
          id: n.id,
          lat: n.lat,
          lng: n.lng,
          size: isEpi ? 0.55 : hit ? 0.32 : 0.12,
          color: isEpi ? "#ff453a" : hit ? "#ff9f0a" : "rgba(255,255,255,0.25)",
          label: n.name,
        };
      });
  }, [worldModel, visibleNodes, epicenter]);

  const objectsData: ObjectDatum[] = useMemo(() => {
    if (!timeline || t == null) return [];
    const out: ObjectDatum[] = [];
    for (const asset of timeline.assets) {
      const pos = sampleAssetPosition(asset, t);
      if (!pos) continue;
      out.push({
        id: asset.id,
        lat: pos.lat,
        lng: pos.lng,
        alt: pos.alt ?? (asset.kind === "plane" ? 0.22 : 0.01),
        kind: asset.kind,
        label: asset.label ?? asset.kind,
      });
    }
    return out;
  }, [timeline, t]);

  const objectThreeObject = useCallback((d: object): Object3D => {
    return makeGlyph((d as ObjectDatum).kind);
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
        const showReroute =
          playing && t != null && t >= 0.44 && disrupted && hot;

        let color: string[] = [
          "rgba(255,255,255,0.08)",
          "rgba(255,255,255,0.08)",
        ];
        let stroke = isAir ? 0.25 : 0.35;
        let dashTime =
          stage === "IDLE" && !playing ? 0 : isAir ? 1800 : 2800;
        let altitude = isAir ? 0.25 : 0.12;

        if (showReroute) {
          altitude = isAir ? 0.35 : 0.22;
          color = ["rgba(48,209,88,0.35)", "rgba(48,209,88,0.7)"];
          stroke = 0.9;
          dashTime = 2200;
        } else if (hot) {
          if (isAir && airThinning) {
            color = ["rgba(10,132,255,0.15)", "rgba(10,132,255,0.35)"];
            stroke = 0.15;
            dashTime = 4000;
          } else if (frozen) {
            color = ["#ff453a", "#ff9f0a"];
            stroke = 1.4;
            dashTime = 0;
          } else {
            color = ["#ff9f0a", "#ff453a"];
            stroke = 1.1;
          }
        } else if (isAir) {
          color = ["rgba(10,132,255,0.12)", "rgba(10,132,255,0.2)"];
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
  ]);

  const rings: RingDatum[] = useMemo(() => {
    if (!epicenter || !nodeMap.has(epicenter)) return [];
    if (stage === "IDLE" && !playing) return [];
    const n = nodeMap.get(epicenter)!;
    const active = playing ? (t ?? 0) < 0.5 : true;
    if (!active && playing) return [];
    return [
      {
        lat: n.lat,
        lng: n.lng,
        maxR: 3.5,
        propagationSpeed: 2.2,
        repeatPeriod: 1400,
      },
    ];
  }, [epicenter, nodeMap, stage, playing, t]);

  const tickerEls: HtmlDatum[] = useMemo(() => {
    if (!tickers.length) return [];
    if (playing && t != null) {
      const count = Math.max(
        0,
        Math.floor(((t - 0.72) / 0.28) * tickers.length)
      );
      return tickers.slice(0, Math.max(0, count)).map((tk) => ({
        kind: "ticker" as const,
        lat: tk.lat,
        lng: tk.lng,
        label: tk.label,
        delta: tk.delta_pct,
      }));
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
      .map((tk) => ({
        kind: "ticker" as const,
        lat: tk.lat,
        lng: tk.lng,
        label: tk.label,
        delta: tk.delta_pct,
      }));
  }, [tickers, stage, propStep, playing, t]);

  const htmlEls: HtmlDatum[] = useMemo(() => {
    const ids = new Set<string>();
    if (epicenter) ids.add(epicenter);
    for (const id of visibleNodes) {
      if (ids.size >= 4) break;
      ids.add(id);
    }
    const labels = Array.from(ids)
      .map((id) => {
        const node = nodeMap.get(id);
        if (!node) return null;
        return {
          kind: "node" as const,
          lat: node.lat,
          lng: node.lng,
          label: node.name,
        };
      })
      .filter(Boolean) as HtmlDatum[];
    return [...labels, ...tickerEls];
  }, [epicenter, visibleNodes, nodeMap, tickerEls]);

  useEffect(() => {
    if (!epicenter || !nodeMap.has(epicenter) || !globeRef.current) return;
    const n = nodeMap.get(epicenter)!;
    if (!playing || t == null) {
      globeRef.current.pointOfView(
        { lat: n.lat, lng: n.lng, altitude: 1.6 },
        1600
      );
      lastCamMode.current = null;
      return;
    }
    let mode = "strike";
    let altitude = 1.4;
    if (t >= 0.78) {
      mode = "impact";
      altitude = 2.6;
    } else if (t >= 0.5) {
      mode = "adapt";
      altitude = 2.2;
    } else if (t >= 0.35) {
      mode = "cascade";
      altitude = 1.8;
    }
    if (lastCamMode.current !== mode) {
      lastCamMode.current = mode;
      const lngOffset = mode === "cascade" ? 12 : mode === "adapt" ? -18 : 0;
      globeRef.current.pointOfView(
        { lat: n.lat, lng: n.lng + lngOffset, altitude },
        1400
      );
    }
  }, [epicenter, nodeMap, playing, t]);

  useEffect(() => {
    if (!globeRef.current || playing) return;
    if (stage === "PROPOSE" || stage === "AWAITING_APPROVAL") {
      globeRef.current.pointOfView({ altitude: 2.1 }, 1800);
    }
  }, [stage, playing]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full bg-atlas-bg"
      style={{
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 500ms ease-out",
      }}
    >
      <Globe
        ref={globeRef}
        width={dims.w}
        height={dims.h}
        backgroundColor="#02070d"
        globeImageUrl="/earth-night.jpg"
        bumpImageUrl="/earth-topology.png"
        atmosphereColor="#39e7f2"
        atmosphereAltitude={0.18}
        onGlobeReady={handleGlobeReady}
        pointsData={points}
        pointAltitude={0.01}
        pointRadius="size"
        pointColor="color"
        pointLabel={(d) => (d as PointDatum).label}
        arcsData={arcs}
        arcColor="color"
        arcStroke="stroke"
        arcAltitude="altitude"
        arcDashLength="dashLength"
        arcDashGap="dashGap"
        arcDashAnimateTime="dashTime"
        ringsData={rings}
        ringColor={() => "rgba(255,69,58,0.7)"}
        ringMaxRadius="maxR"
        ringPropagationSpeed="propagationSpeed"
        ringRepeatPeriod="repeatPeriod"
        objectsData={objectsData}
        objectLat="lat"
        objectLng="lng"
        objectAltitude="alt"
        objectThreeObject={objectThreeObject}
        htmlElementsData={htmlEls}
        htmlElement={(d) => {
          const el = document.createElement("div");
          const data = d as HtmlDatum;
          if (data.kind === "node") {
            el.className = "globe-node-label";
            el.textContent = data.label;
            return el;
          }
          const delta = data.delta ?? 0;
          const up = delta >= 0;
          el.className = "ticker-chip";
          el.innerHTML = `<span style="color:rgba(255,255,255,0.55)">${data.label}</span> <span style="color:${up ? "#ff8a32" : "#31d9a0"}">${up ? "+" : ""}${delta}%</span>`;
          return el;
        }}
        htmlAltitude={0.02}
      />
      {eventTitle && stage !== "IDLE" && !playing && (
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
