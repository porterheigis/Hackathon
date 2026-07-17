"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import type { PipelineStage, WorldModel } from "@/lib/types";

interface GlobeViewProps {
  worldModel: WorldModel | null;
  epicenter: string | null;
  affectedNodes: string[];
  affectedEdges: string[];
  propagationOrder: string[];
  stage: PipelineStage;
  eventTitle: string | null;
}

interface ArcDatum {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string[];
  stroke: number;
  id: string;
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

export default function GlobeView({
  worldModel,
  epicenter,
  affectedNodes,
  affectedEdges,
  propagationOrder,
  stage,
  eventTitle,
}: GlobeViewProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 600, h: 600 });
  const [propStep, setPropStep] = useState(0);

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
    g.controls().autoRotate = stage === "IDLE";
    g.controls().autoRotateSpeed = 0.35;
    g.pointOfView({ altitude: 2.2 }, 0);
  }, [stage]);

  // Animate propagation during SIMULATE
  useEffect(() => {
    if (stage !== "SIMULATE" && stage !== "MODEL") {
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
    }, 180);
    return () => clearInterval(id);
  }, [stage, propagationOrder, affectedNodes]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, { lat: number; lng: number; name: string }>();
    for (const n of worldModel?.nodes ?? []) {
      m.set(n.id, { lat: n.lat, lng: n.lng, name: n.name });
    }
    return m;
  }, [worldModel]);

  const visibleNodes = useMemo(() => {
    if (!propagationOrder.length && !affectedNodes.length) return new Set<string>();
    const order = propagationOrder.length ? propagationOrder : affectedNodes;
    return new Set(order.slice(0, Math.max(1, propStep)));
  }, [propagationOrder, affectedNodes, propStep]);

  const points: PointDatum[] = useMemo(() => {
    if (!worldModel) return [];
    return worldModel.nodes
      .filter((n) => n.type === "chokepoint" || n.type === "port" || n.type === "hub")
      .map((n) => {
        const hit = visibleNodes.has(n.id) || n.id === epicenter;
        const isEpi = n.id === epicenter;
        return {
          id: n.id,
          lat: n.lat,
          lng: n.lng,
          size: isEpi ? 0.55 : hit ? 0.35 : 0.15,
          color: isEpi ? "#ff5c5c" : hit ? "#ffb454" : "#3d4a5c",
          label: n.name,
        };
      });
  }, [worldModel, visibleNodes, epicenter]);

  const arcs: ArcDatum[] = useMemo(() => {
    if (!worldModel) return [];
    return worldModel.edges
      .map((e) => {
        const a = nodeMap.get(e.from);
        const b = nodeMap.get(e.to);
        if (!a || !b) return null;
        const hot =
          affectedEdges.includes(e.id) &&
          (visibleNodes.has(e.from) || visibleNodes.has(e.to));
        return {
          id: e.id,
          startLat: a.lat,
          startLng: a.lng,
          endLat: b.lat,
          endLng: b.lng,
          color: hot ? ["#ffb454", "#ff5c5c"] : ["#1c2430", "#1c2430"],
          stroke: hot ? 1.2 : 0.35,
        };
      })
      .filter(Boolean) as ArcDatum[];
  }, [worldModel, nodeMap, affectedEdges, visibleNodes]);

  const rings: RingDatum[] = useMemo(() => {
    if (!epicenter || !nodeMap.has(epicenter)) return [];
    if (stage === "IDLE") return [];
    const n = nodeMap.get(epicenter)!;
    return [
      {
        lat: n.lat,
        lng: n.lng,
        maxR: 4,
        propagationSpeed: 2.5,
        repeatPeriod: 1200,
      },
    ];
  }, [epicenter, nodeMap, stage]);

  // Focus camera on epicenter when event lands
  useEffect(() => {
    if (!epicenter || !nodeMap.has(epicenter) || !globeRef.current) return;
    const n = nodeMap.get(epicenter)!;
    globeRef.current.pointOfView({ lat: n.lat, lng: n.lng, altitude: 1.8 }, 1200);
  }, [epicenter, nodeMap]);

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
        pointLabel={(d) => (d as PointDatum).label}
        arcsData={arcs}
        arcColor="color"
        arcStroke="stroke"
        arcDashLength={0.4}
        arcDashGap={0.2}
        arcDashAnimateTime={stage === "IDLE" ? 0 : 2500}
        ringsData={rings}
        ringColor={() => "#ff5c5c"}
        ringMaxRadius="maxR"
        ringPropagationSpeed="propagationSpeed"
        ringRepeatPeriod="repeatPeriod"
      />
      {eventTitle && stage !== "IDLE" && (
        <div className="pointer-events-none absolute bottom-4 left-4 right-4 font-mono text-[11px] text-atlas-amber">
          <span className="tracking-[0.12em] uppercase">Event</span>
          <p className="mt-0.5 max-w-lg text-atlas-text">{eventTitle}</p>
        </div>
      )}
    </div>
  );
}
