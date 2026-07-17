"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap, type Marker } from "maplibre-gl";
import { motion, AnimatePresence } from "framer-motion";
import type { DetectionRow, PipelineStage, WorldModel } from "@/lib/types";

interface TacticalViewProps {
  worldModel: WorldModel | null;
  epicenter: string | null;
  stage: PipelineStage;
  detections?: DetectionRow[];
  vesselCount?: number;
  visible?: boolean;
  eventTitle?: string | null;
}

/** Simple geofence polygon around a lat/lng point (approx degrees) */
function geofenceAround(lat: number, lng: number, pad = 1.4): number[][] {
  return [
    [lng - pad * 1.2, lat - pad * 0.7],
    [lng + pad * 1.2, lat - pad * 0.7],
    [lng + pad * 1.2, lat + pad * 0.7],
    [lng - pad * 1.2, lat + pad * 0.7],
    [lng - pad * 1.2, lat - pad * 0.7],
  ];
}

const ESRI =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export default function TacticalView({
  worldModel,
  epicenter,
  stage,
  detections = [],
  vesselCount = 0,
  visible = false,
  eventTitle,
}: TacticalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [utc, setUtc] = useState("");

  const epicenterNode = useMemo(() => {
    if (!epicenter || !worldModel) return null;
    return worldModel.nodes.find((n) => n.id === epicenter) ?? null;
  }, [epicenter, worldModel]);

  useEffect(() => {
    const tick = () =>
      setUtc(new Date().toISOString().replace(/\.\d+Z$/, "Z"));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          esri: {
            type: "raster",
            tiles: [ESRI],
            tileSize: 256,
            attribution: "Esri World Imagery",
          },
        },
        layers: [{ id: "esri", type: "raster", source: "esri" }],
      },
      center: [56.25, 26.57],
      zoom: 6.2,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.on("load", () => setReady(true));
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Fly to epicenter + draw geofence
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !epicenterNode) return;

    map.flyTo({
      center: [epicenterNode.lng, epicenterNode.lat],
      zoom: 7.2,
      duration: 1600,
      essential: true,
    });

    const poly = geofenceAround(epicenterNode.lat, epicenterNode.lng);
    const sourceId = "aoi";
    const geojson: GeoJSON.Feature = {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [poly] },
    };

    if (map.getSource(sourceId)) {
      (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(geojson);
    } else {
      map.addSource(sourceId, { type: "geojson", data: geojson });
      map.addLayer({
        id: "aoi-fill",
        type: "fill",
        source: sourceId,
        paint: { "fill-color": "#ff453a", "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: "aoi-line",
        type: "line",
        source: sourceId,
        paint: {
          "line-color": "#ff453a",
          "line-width": 1.5,
          "line-dasharray": [2, 1.5],
        },
      });
    }
  }, [epicenterNode, ready]);

  // Vessel markers accumulate
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !epicenterNode) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const count =
      vesselCount ||
      (stage === "SIMULATE" || stage === "PROPOSE" || stage === "AWAITING_APPROVAL"
        ? 10
        : 0);
    for (let i = 0; i < count; i++) {
      const ang = (i / Math.max(count, 1)) * Math.PI * 2;
      const lat = epicenterNode.lat + Math.cos(ang) * (0.35 + (i % 3) * 0.15);
      const lng = epicenterNode.lng + Math.sin(ang) * (0.45 + (i % 3) * 0.2);
      const el = document.createElement("div");
      el.style.width = "10px";
      el.style.height = "10px";
      el.style.background = "#ff453a";
      el.style.transform = "rotate(45deg)";
      el.style.border = "1px solid rgba(255,255,255,0.5)";
      el.style.boxShadow = "0 0 6px rgba(255,69,58,0.6)";
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map);
      markersRef.current.push(marker);
    }
  }, [vesselCount, epicenterNode, ready, stage]);

  return (
    <div
      className="tactical-stage absolute inset-0"
      style={{
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 600ms ease-out",
        zIndex: visible ? 2 : 0,
      }}
    >
      <div className="tactical-fallback" aria-hidden="true" />
      <div ref={containerRef} className="tactical-map h-full w-full" />

      {/* HUD */}
      <div className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] text-white/70">
        <div>
          {epicenterNode
            ? `${epicenterNode.lat.toFixed(4)}°N  ${epicenterNode.lng.toFixed(4)}°E`
            : "—"}
        </div>
        <div className="text-white/40">{utc}</div>
      </div>

      <div className="pointer-events-none absolute right-3 top-3 max-w-[220px]">
        <div className="panel px-3 py-2">
          <p className="eyebrow mb-2">Detections</p>
          <AnimatePresence>
            {(detections.length
              ? detections
              : [
                  {
                    id: "hold",
                    label: "TANKERS HOLDING",
                    value: String(vesselCount || "—"),
                    tone: "crit" as const,
                  },
                ]
            ).map((d, i) => (
              <motion.div
                key={d.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.22 }}
                className="mb-1.5 flex items-baseline justify-between gap-3 last:mb-0"
              >
                <span className="text-[11px] text-white/55">{d.label}</span>
                <span
                  className={`font-mono text-[11px] tabular ${
                    d.tone === "crit"
                      ? "text-atlas-red"
                      : d.tone === "warn"
                        ? "text-atlas-amber"
                        : "text-atlas-text"
                  }`}
                >
                  {d.value}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {eventTitle && (
        <div className="pointer-events-none absolute bottom-4 left-4">
          <p className="eyebrow">AOI</p>
          <p className="mt-0.5 max-w-md text-[13px] text-white/90">
            {epicenterNode?.name ?? "—"} · {eventTitle}
          </p>
        </div>
      )}
    </div>
  );
}
