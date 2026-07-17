"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
// Reuse the ALREADY-PINNED three (0.185.1 via package override) — the same
// instance react-globe.gl/three-globe use. Do NOT add any other three/renderer.
import * as THREE from "three";
import type {
  EdgeStatus,
  LiveTransportAsset,
  NodeStatus,
  PipelineStage,
  PropagationEvent,
  WorldModel,
} from "@/lib/types";
import { EDGE_HEX, NODE_HEX } from "./format";
import { GlobeLegend } from "./GlobeLegend";

// ─── Observed-transport layer constants ─────────────────────
const OBSERVED_LIVE_HEX = "#39d3f5"; // cyan  — observed live
const OBSERVED_REPLAY_HEX = "#5a7d9a"; // muted blue — observed replay
const EXPOSED_HEX = "#ffb454"; // amber — exposed observed asset
const MAX_VESSELS = 100;
const MAX_AIRCRAFT = 60;

export interface TransportLayerToggles {
  vessels: boolean;
  aircraft: boolean;
  routes: boolean;
  labels: boolean;
}

const DEFAULT_LAYERS: TransportLayerToggles = {
  vessels: true,
  aircraft: true,
  routes: true,
  labels: false,
};

interface GlobeViewProps {
  worldModel: WorldModel | null;
  epicenter: string | null;
  nodeStatuses: Record<string, NodeStatus>;
  edgeStatuses: Record<string, EdgeStatus>;
  propagationOrder: string[];
  propagationEvents: PropagationEvent[];
  affectedNodes: string[];
  affectedEdges: string[];
  stage: PipelineStage;
  scenarioTitle: string | null;
  // ─── Live-transport (observed) layer ───
  vessels?: LiveTransportAsset[];
  aircraft?: LiveTransportAsset[];
  exposedAssetIds?: string[];
  layers?: TransportLayerToggles;
  onSelectAsset?: (asset: LiveTransportAsset) => void;
}

interface ArcDatum {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string[];
  stroke: number;
  dashAnimate: number;
  id: string;
  label: string;
}

interface PointDatum {
  lat: number;
  lng: number;
  size: number;
  color: string;
  label: string;
  id: string;
  status: NodeStatus;
  isEpicenter: boolean;
}

interface RingDatum {
  lat: number;
  lng: number;
  maxR: number;
  propagationSpeed: number;
  repeatPeriod: number;
  color: string;
}

interface MarkerDatum {
  asset: LiveTransportAsset;
  lat: number;
  lng: number;
  color: string;
  rotation: number; // heading in degrees; 0 when unknown or reduced motion
  kind: "vessel" | "aircraft";
}

interface LabelDatum {
  lat: number;
  lng: number;
  text: string;
  color: string;
}

interface TailDatum {
  id: string;
  coords: Array<[number, number]>; // [lat, lng]
  color: string;
}

// ─── Observed-marker WebGL meshes (objectsData layer) ───
// Flat shapes modeled in the local XY plane (normal +Z, "north" = +Y). With
// objectFacesSurfaces the three-globe objects layer orients local +Z to the
// outward surface normal, so these lie tangent to the globe and face the viewer.
// GLOBE_RADIUS is 100, so a few units reads as a small marker.
function makeGeometry(verts: number[], indices: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// Vessel = compact triangle pointing north (+Y).
const VESSEL_GEOM = makeGeometry(
  [0, 2.2, 0, 1.5, -1.3, 0, -1.5, -1.3, 0],
  [0, 1, 2]
);
// Aircraft = slimmer, longer chevron/arrow pointing north (+Y).
const AIRCRAFT_GEOM = makeGeometry(
  [0, 2.9, 0, 1.6, -1.7, 0, 0, -0.7, 0, -1.6, -1.7, 0],
  [0, 1, 2, 0, 2, 3]
);

// three-globe's polar2Cartesian frame (GLOBE_RADIUS units); layers place objects
// in this frame, so we orient markers here to match.
function polar2Cartesian(lat: number, lng: number): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((90 - lng) * Math.PI) / 180;
  const s = Math.sin(phi);
  return new THREE.Vector3(s * Math.cos(theta), Math.cos(phi), s * Math.sin(theta));
}

const _up = new THREE.Vector3(0, 1, 0);
/**
 * Orient a flat marker mesh tangent to the globe surface at (lat,lng) — local +Z
 * to the outward normal, +Y to north — then rotate by heading about the normal.
 * Best-effort: near the poles the east basis degenerates and the marker just
 * renders flat (position is always correct). Reduced-motion/null heading → 0.
 */
function orientTangent(
  mesh: THREE.Object3D,
  lat: number,
  lng: number,
  headingDeg: number
): void {
  const n = polar2Cartesian(lat, lng).normalize();
  const east = new THREE.Vector3().crossVectors(_up, n);
  if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
  else east.normalize();
  const north = new THREE.Vector3().crossVectors(n, east).normalize();
  const basis = new THREE.Matrix4().makeBasis(east, north, n);
  mesh.setRotationFromMatrix(basis);
  if (headingDeg) mesh.rotateZ((-headingDeg * Math.PI) / 180);
}

// Materials are cached by color so meshes sharing a color reuse one material.
const MATERIAL_CACHE = new Map<string, THREE.MeshBasicMaterial>();
function materialFor(hex: string): THREE.MeshBasicMaterial {
  let m = MATERIAL_CACHE.get(hex);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(hex),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    MATERIAL_CACHE.set(hex, m);
  }
  return m;
}

function sourceLabel(source: LiveTransportAsset["source"]): string {
  switch (source) {
    case "aisstream":
      return "AISStream";
    case "adsb-lol":
      return "ADSB.lol";
    default:
      return "Replay";
  }
}

function ageLabel(ageSeconds: number): string {
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0) return "—";
  if (ageSeconds < 90) return `${Math.round(ageSeconds)}s ago`;
  const m = Math.round(ageSeconds / 60);
  return `${m}m ago`;
}

/** Short backward-extrapolated observed track (2–4 points ending at the asset). */
function buildTail(a: LiveTransportAsset): Array<[number, number]> | null {
  if (a.headingDegrees === null || a.speedKnots === null || a.speedKnots <= 0) {
    return null;
  }
  const h = (a.headingDegrees * Math.PI) / 180;
  const latRad = (a.latitude * Math.PI) / 180;
  const cosLat = Math.max(0.15, Math.cos(latRad));
  // Scale the tail length by observed speed, clamped to a small, legible range.
  const deg = Math.min(0.8, Math.max(0.05, a.speedKnots * 0.004));
  const dLat = Math.cos(h) * deg;
  const dLng = (Math.sin(h) * deg) / cosLat;
  // k = fraction "behind" the asset; 0 is the current position.
  return [1, 0.5, 0].map((k) => [
    a.latitude - dLat * k,
    a.longitude - dLng * k,
  ]) as Array<[number, number]>;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

export default function GlobeView({
  worldModel,
  epicenter,
  nodeStatuses,
  edgeStatuses,
  propagationOrder,
  affectedNodes,
  affectedEdges,
  stage,
  scenarioTitle,
  vessels = [],
  aircraft = [],
  exposedAssetIds = [],
  layers = DEFAULT_LAYERS,
  onSelectAsset,
}: GlobeViewProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 700, h: 700 });
  const [propStep, setPropStep] = useState(999);
  const [activeAsset, setActiveAsset] = useState<LiveTransportAsset | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  // Keep the latest onSelectAsset without re-creating the (stable) htmlElement factory.
  const onSelectRef = useRef(onSelectAsset);
  useEffect(() => {
    onSelectRef.current = onSelectAsset;
  }, [onSelectAsset]);

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
    g.controls().autoRotate = stage === "IDLE" && !reducedMotion;
    g.controls().autoRotateSpeed = 0.3;
  }, [stage, reducedMotion]);

  // Progressive reveal of propagation during MODEL / SIMULATE.
  useEffect(() => {
    const order = propagationOrder.length ? propagationOrder : affectedNodes;
    if (stage !== "SIMULATE" && stage !== "MODEL") {
      setPropStep(order.length || 999);
      return;
    }
    if (!order.length) {
      setPropStep(999);
      return;
    }
    setPropStep(1);
    if (reducedMotion) {
      setPropStep(order.length);
      return;
    }
    let i = 1;
    const id = setInterval(() => {
      i += 1;
      setPropStep(i);
      if (i >= order.length) clearInterval(id);
    }, 200);
    return () => clearInterval(id);
  }, [stage, propagationOrder, affectedNodes, reducedMotion]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, { lat: number; lng: number; name: string }>();
    for (const n of worldModel?.nodes ?? []) {
      m.set(n.id, { lat: n.lat, lng: n.lng, name: n.name });
    }
    return m;
  }, [worldModel]);

  const revealed = useMemo(() => {
    const order = propagationOrder.length ? propagationOrder : affectedNodes;
    if (!order.length) return null; // null = reveal all
    return new Set(order.slice(0, Math.max(1, propStep)));
  }, [propagationOrder, affectedNodes, propStep]);

  const statusFor = (id: string): NodeStatus => {
    if (revealed && !revealed.has(id) && id !== epicenter) return "normal";
    return nodeStatuses[id] ?? "normal";
  };

  const edgeStatusFor = (e: { id: string; from: string; to: string }): EdgeStatus => {
    const st = edgeStatuses[e.id] ?? "normal";
    if (st === "normal") return "normal";
    if (revealed && !revealed.has(e.from) && !revealed.has(e.to)) return "normal";
    return st;
  };

  const points: PointDatum[] = useMemo(() => {
    if (!worldModel) return [];
    return worldModel.nodes.map((n) => {
      const isEpi = n.id === epicenter;
      const status = statusFor(n.id);
      const hot = status !== "normal" || isEpi;
      return {
        id: n.id,
        lat: n.lat,
        lng: n.lng,
        size: isEpi ? 0.5 : hot ? 0.34 : 0.14,
        color: isEpi ? NODE_HEX.disrupted : NODE_HEX[status],
        label: n.name,
        status,
        isEpicenter: isEpi,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldModel, nodeStatuses, epicenter, revealed]);

  // Supply-chain routes (simulated). Alternative reroutes render GREEN + dashed.
  const arcs: ArcDatum[] = useMemo(() => {
    if (!worldModel || !layers.routes) return [];
    return worldModel.edges
      .map((e) => {
        const a = nodeMap.get(e.from);
        const b = nodeMap.get(e.to);
        if (!a || !b) return null;
        const st = edgeStatusFor(e);
        const hex = EDGE_HEX[st];
        const hot = st !== "normal";
        const routeLabel =
          st === "alternative"
            ? "Simulated alternative route"
            : `${e.lane ?? e.mode ?? "route"} · ${st}`;
        return {
          id: e.id,
          startLat: a.lat,
          startLng: a.lng,
          endLat: b.lat,
          endLng: b.lng,
          color: hot ? [hex, hex] : [EDGE_HEX.normal, EDGE_HEX.normal],
          stroke: hot ? 0.9 : 0.3,
          dashAnimate: hot && stage !== "IDLE" && !reducedMotion ? 2200 : 0,
          label: routeLabel,
        };
      })
      .filter(Boolean) as ArcDatum[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldModel, nodeMap, edgeStatuses, revealed, stage, layers.routes, reducedMotion]);

  const rings: RingDatum[] = useMemo(() => {
    if (!epicenter || !nodeMap.has(epicenter) || stage === "IDLE") return [];
    const n = nodeMap.get(epicenter)!;
    return [
      {
        lat: n.lat,
        lng: n.lng,
        maxR: 5,
        propagationSpeed: 2.4,
        repeatPeriod: reducedMotion ? 0 : 1100,
        color: "#ff5c5c",
      },
    ];
  }, [epicenter, nodeMap, stage, reducedMotion]);

  // ─── Observed markers (WebGL objectsData layer) ───
  const exposedSet = useMemo(() => new Set(exposedAssetIds), [exposedAssetIds]);

  const markerData: MarkerDatum[] = useMemo(() => {
    const out: MarkerDatum[] = [];
    const build = (a: LiveTransportAsset, kind: "vessel" | "aircraft") => {
      const exposed = exposedSet.has(a.id);
      const color = exposed
        ? EXPOSED_HEX
        : a.dataMode === "replay"
          ? OBSERVED_REPLAY_HEX
          : OBSERVED_LIVE_HEX;
      out.push({
        asset: a,
        lat: a.latitude,
        lng: a.longitude,
        color,
        rotation: reducedMotion || a.headingDegrees === null ? 0 : a.headingDegrees,
        kind,
      });
    };
    if (layers.vessels) {
      for (const v of vessels.slice(0, MAX_VESSELS)) build(v, "vessel");
    }
    if (layers.aircraft) {
      for (const a of aircraft.slice(0, MAX_AIRCRAFT)) build(a, "aircraft");
    }
    return out;
  }, [vessels, aircraft, exposedSet, layers.vessels, layers.aircraft, reducedMotion]);

  // Optional persistent name labels (built-in WebGL labels layer; off by default).
  const labelData: LabelDatum[] = useMemo(() => {
    if (!layers.labels) return [];
    return markerData.map((m) => ({
      lat: m.lat,
      lng: m.lng,
      text: m.asset.displayName ?? m.asset.callsign ?? m.asset.id,
      color: "#9fb0c0",
    }));
  }, [markerData, layers.labels]);

  // ─── Observed tracks (pathsData) — thin, SOLID; distinct from dashed routes ───
  const tails: TailDatum[] = useMemo(() => {
    const out: TailDatum[] = [];
    const push = (a: LiveTransportAsset) => {
      const coords = buildTail(a);
      if (!coords) return;
      const color = a.dataMode === "replay" ? OBSERVED_REPLAY_HEX : OBSERVED_LIVE_HEX;
      out.push({ id: `tail-${a.id}`, coords, color });
    };
    if (layers.vessels) for (const v of vessels.slice(0, MAX_VESSELS)) push(v);
    if (layers.aircraft) for (const a of aircraft.slice(0, MAX_AIRCRAFT)) push(a);
    return out;
  }, [vessels, aircraft, layers.vessels, layers.aircraft]);

  // Stable WebGL factory: returns a fresh Mesh per datum (shared geometry +
  // cached material). Orientation is baked in here (tangent to the surface, then
  // rotated by heading about the outward normal) rather than via the objects
  // layer's objectFacesSurface/objectRotation props — the mesh child keeps this
  // local rotation because we do not pass objectRotation. Stable identity so
  // three-globe rebuilds objects only when markerData identity changes.
  const objectThreeObject = useCallback((d: object) => {
    const m = d as MarkerDatum;
    const geom = m.kind === "vessel" ? VESSEL_GEOM : AIRCRAFT_GEOM;
    const mesh = new THREE.Mesh(geom, materialFor(m.color));
    orientTangent(mesh, m.lat, m.lng, m.rotation);
    return mesh;
  }, []);

  // Focus camera: epicenter when a scenario lands, world view when idle.
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    if (stage === "IDLE" || !epicenter || !nodeMap.has(epicenter)) {
      g.pointOfView({ lat: 15, lng: 120, altitude: 2.5 }, reducedMotion ? 0 : 1200);
      return;
    }
    const n = nodeMap.get(epicenter)!;
    g.pointOfView({ lat: n.lat, lng: n.lng, altitude: 1.9 }, reducedMotion ? 0 : 1400);
  }, [epicenter, nodeMap, stage, reducedMotion]);

  const epicenterName = epicenter ? nodeMap.get(epicenter)?.name : null;
  const disruptedCount = Object.values(nodeStatuses).filter(
    (s) => s === "disrupted"
  ).length;

  const isExposedActive = activeAsset ? exposedSet.has(activeAsset.id) : false;

  return (
    <div ref={containerRef} className="relative h-full w-full bg-atlas-bg">
      <Globe
        ref={globeRef}
        width={dims.w}
        height={dims.h}
        backgroundColor="#0a0e14"
        globeImageUrl="//cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg"
        bumpImageUrl="//cdn.jsdelivr.net/npm/three-globe/example/img/earth-topology.png"
        atmosphereColor="#39d3f5"
        atmosphereAltitude={0.12}
        pointsData={points}
        pointAltitude={0.01}
        pointRadius="size"
        pointColor="color"
        pointLabel={(d) => {
          const p = d as PointDatum;
          return `<div style="font-family:var(--font-plex),monospace;font-size:11px;color:#e8eef4;background:#0a0e14cc;border:1px solid #1c2430;padding:4px 6px">${p.label}<span style="color:#6b7785"> · ${p.status}</span></div>`;
        }}
        arcsData={arcs}
        arcColor="color"
        arcStroke="stroke"
        arcDashLength={0.45}
        arcDashGap={0.2}
        arcDashAnimateTime={(d) => (d as ArcDatum).dashAnimate}
        arcLabel={(d) => (d as ArcDatum).label}
        arcsTransitionDuration={200}
        ringsData={rings}
        ringColor={() => (t: number) => `rgba(255,92,92,${1 - t})`}
        ringMaxRadius="maxR"
        ringPropagationSpeed="propagationSpeed"
        ringRepeatPeriod="repeatPeriod"
        pathsData={tails}
        pathPoints="coords"
        pathPointLat={(p) => (p as [number, number])[0]}
        pathPointLng={(p) => (p as [number, number])[1]}
        pathColor={(d: object) => (d as TailDatum).color}
        pathStroke={0.6}
        pathDashLength={1}
        pathDashGap={0}
        pathPointAlt={0.004}
        pathTransitionDuration={0}
        pathLabel={(d: object) => (d as TailDatum).id}
        objectsData={markerData}
        objectLat="lat"
        objectLng="lng"
        objectAltitude={0.012}
        objectThreeObject={objectThreeObject}
        objectLabel={() => ""}
        onObjectHover={(o) =>
          setActiveAsset(o ? (o as MarkerDatum).asset : null)
        }
        onObjectClick={(o) => {
          const a = (o as MarkerDatum).asset;
          setActiveAsset(a);
          onSelectRef.current?.(a);
        }}
        labelsData={labelData}
        labelLat="lat"
        labelLng="lng"
        labelText="text"
        labelColor="color"
        labelSize={0.55}
        labelDotRadius={0}
        labelAltitude={0.014}
        labelResolution={1}
      />

      <GlobeLegend />

      {/* Observed-asset popover (hover / selection only) */}
      {activeAsset && (
        <div className="pointer-events-none absolute right-3 bottom-3 z-10 w-56 rounded-sm border border-atlas-hairline bg-atlas-bg/90 px-3 py-2 font-mono backdrop-blur-[2px]">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[11px] text-atlas-bright">
              {activeAsset.type === "vessel"
                ? activeAsset.displayName ?? activeAsset.id
                : activeAsset.callsign ?? activeAsset.id}
            </span>
            <span
              className="rounded-sm px-1 py-0.5 text-[8px] tracking-[0.1em] uppercase"
              style={{
                color: isExposedActive
                  ? EXPOSED_HEX
                  : activeAsset.dataMode === "replay"
                    ? OBSERVED_REPLAY_HEX
                    : OBSERVED_LIVE_HEX,
                border: `1px solid ${
                  isExposedActive
                    ? EXPOSED_HEX
                    : activeAsset.dataMode === "replay"
                      ? OBSERVED_REPLAY_HEX
                      : OBSERVED_LIVE_HEX
                }55`,
              }}
            >
              {isExposedActive
                ? "Exposed"
                : activeAsset.dataMode === "replay"
                  ? "Observed replay"
                  : "Observed live"}
            </span>
          </div>
          <dl className="flex flex-col gap-0.5 text-[10px]">
            {activeAsset.type === "aircraft" && activeAsset.altitudeFeet !== null && (
              <AssetRow label="Altitude" value={`${Math.round(activeAsset.altitudeFeet)} ft`} />
            )}
            {activeAsset.speedKnots !== null && (
              <AssetRow
                label={activeAsset.type === "aircraft" ? "Ground speed" : "Speed"}
                value={`${Math.round(activeAsset.speedKnots)} kn`}
              />
            )}
            {activeAsset.headingDegrees !== null && (
              <AssetRow label="Heading" value={`${Math.round(activeAsset.headingDegrees)}°`} />
            )}
            {activeAsset.destination && (
              <AssetRow label="Destination" value={activeAsset.destination} />
            )}
            <AssetRow label="Last observed" value={ageLabel(activeAsset.ageSeconds)} />
            <AssetRow label="Source" value={sourceLabel(activeAsset.source)} />
          </dl>
        </div>
      )}

      {epicenterName && stage !== "IDLE" && (
        <div className="pointer-events-none absolute left-3 bottom-3 max-w-md font-mono text-[11px]">
          <div className="flex items-center gap-2 text-atlas-red">
            <span className="tracking-[0.15em] uppercase">Epicenter</span>
            <span className="h-1 w-1 rounded-full bg-atlas-red" />
            <span className="text-atlas-bright">{epicenterName}</span>
          </div>
          {scenarioTitle && (
            <p className="mt-1 font-sans text-[12px] leading-snug text-atlas-text">
              {scenarioTitle}
            </p>
          )}
          {disruptedCount > 0 && (
            <p className="mt-1 tracking-[0.12em] text-atlas-muted uppercase">
              {disruptedCount} node{disruptedCount === 1 ? "" : "s"} disrupted ·{" "}
              {affectedEdges.length} route{affectedEdges.length === 1 ? "" : "s"}{" "}
              affected
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AssetRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-atlas-dim uppercase tracking-[0.08em] text-[9px]">{label}</span>
      <span className="text-atlas-text">{value}</span>
    </div>
  );
}
