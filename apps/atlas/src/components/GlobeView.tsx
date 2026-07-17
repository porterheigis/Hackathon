"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import type { PipelineStage, PriceTicker, WorldModel } from "@/lib/types";

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
  lat: number;
  lng: number;
  label: string;
  delta: number;
}

const BLUE_MARBLE =
  "//unpkg.com/three-globe/example/img/earth-blue-marble.jpg";
const TOPOLOGY =
  "//unpkg.com/three-globe/example/img/earth-topology.png";

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
    g.controls().autoRotateSpeed = 0.25;
    g.controls().enableDamping = true;
  }, [stage]);

  useEffect(() => {
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
  }, [stage, propagationOrder, affectedNodes]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, { lat: number; lng: number; name: string }>();
    for (const n of worldModel?.nodes ?? []) {
      m.set(n.id, { lat: n.lat, lng: n.lng, name: n.name });
    }
    return m;
  }, [worldModel]);

  const visibleNodes = useMemo(() => {
    if (!propagationOrder.length && !affectedNodes.length)
      return new Set<string>();
    const order = propagationOrder.length ? propagationOrder : affectedNodes;
    return new Set(order.slice(0, Math.max(1, propStep)));
  }, [propagationOrder, affectedNodes, propStep]);

  const wantsAir = selectedOutcomes.includes("air_travel");
  const airThinning =
    wantsAir && (stage === "SIMULATE" || stage === "PROPOSE" || stage === "AWAITING_APPROVAL");

  const points: PointDatum[] = useMemo(() => {
    if (!worldModel) return [];
    const base = worldModel.nodes
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

    // Queued tankers near epicenter during sim
    if (
      epicenter &&
      nodeMap.has(epicenter) &&
      (stage === "SIMULATE" || stage === "PROPOSE" || stage === "AWAITING_APPROVAL")
    ) {
      const epi = nodeMap.get(epicenter)!;
      const count = Math.min(12, 4 + Math.floor(propStep / 2));
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2;
        base.push({
          id: `tanker-${i}`,
          lat: epi.lat + Math.cos(ang) * 1.2,
          lng: epi.lng + Math.sin(ang) * 1.2,
          size: 0.18,
          color: "#ff453a",
          label: `Vessel ${i + 1}`,
        });
      }
    }
    return base;
  }, [worldModel, visibleNodes, epicenter, stage, propStep, nodeMap]);

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
        const frozen = disrupted && hot;

        let color: string[] = ["rgba(255,255,255,0.08)", "rgba(255,255,255,0.08)"];
        let stroke = isAir ? 0.25 : 0.35;
        let dashTime = stage === "IDLE" ? 0 : isAir ? 1800 : 2800;
        const altitude = isAir ? 0.25 : 0.12;

        if (hot) {
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
  ]);

  const rings: RingDatum[] = useMemo(() => {
    if (!epicenter || !nodeMap.has(epicenter)) return [];
    if (stage === "IDLE") return [];
    const n = nodeMap.get(epicenter)!;
    return [
      {
        lat: n.lat,
        lng: n.lng,
        maxR: 3.5,
        propagationSpeed: 2.2,
        repeatPeriod: 1400,
      },
    ];
  }, [epicenter, nodeMap, stage]);

  const htmlEls: HtmlDatum[] = useMemo(() => {
    if (!tickers.length) return [];
    if (
      stage !== "SIMULATE" &&
      stage !== "PROPOSE" &&
      stage !== "AWAITING_APPROVAL" &&
      stage !== "DONE"
    )
      return [];
    return tickers.slice(0, Math.max(1, Math.floor(propStep / 2) + 1)).map((t) => ({
      lat: t.lat,
      lng: t.lng,
      label: t.label,
      delta: t.delta_pct,
    }));
  }, [tickers, stage, propStep]);

  useEffect(() => {
    if (!epicenter || !nodeMap.has(epicenter) || !globeRef.current) return;
    const n = nodeMap.get(epicenter)!;
    globeRef.current.pointOfView({ lat: n.lat, lng: n.lng, altitude: 1.6 }, 1600);
  }, [epicenter, nodeMap]);

  useEffect(() => {
    if (!globeRef.current) return;
    if (stage === "PROPOSE" || stage === "AWAITING_APPROVAL") {
      globeRef.current.pointOfView({ altitude: 2.1 }, 1800);
    }
  }, [stage]);

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
        backgroundColor="#0b0b0d"
        globeImageUrl={BLUE_MARBLE}
        bumpImageUrl={TOPOLOGY}
        atmosphereColor="#6eb6ff"
        atmosphereAltitude={0.15}
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
        htmlElementsData={htmlEls}
        htmlElement={(d) => {
          const el = document.createElement("div");
          const data = d as HtmlDatum;
          const up = data.delta >= 0;
          el.className = "ticker-chip";
          el.innerHTML = `<span style="color:rgba(255,255,255,0.55)">${data.label}</span> <span style="color:${up ? "#ff453a" : "#30d158"}">${up ? "+" : ""}${data.delta}%</span>`;
          return el;
        }}
        htmlAltitude={0.02}
      />
      {eventTitle && stage !== "IDLE" && (
        <div className="pointer-events-none absolute bottom-4 left-4 right-4">
          <p className="eyebrow">Event</p>
          <p className="mt-0.5 max-w-lg text-[13px] text-atlas-text">{eventTitle}</p>
        </div>
      )}
    </div>
  );
}
