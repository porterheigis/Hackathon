"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap, type Marker } from "maplibre-gl";
import { AnimatePresence, motion } from "framer-motion";
import {
  sampleAssetHeading,
  sampleAssetOpacity,
  sampleAssetPosition,
} from "@/lib/timeline";
import type {
  DetectionRow,
  PipelineStage,
  SimTimeline,
  TimelineAsset,
  WorldModel,
} from "@/lib/types";

interface TacticalViewProps {
  worldModel: WorldModel | null;
  epicenter: string | null;
  stage: PipelineStage;
  detections?: DetectionRow[];
  vesselCount?: number;
  visible?: boolean;
  eventTitle?: string | null;
  timeline?: SimTimeline | null;
  playbackT?: number | null;
}

/** Circular AOI polygon (organic maritime zone) */
function circlePolygon(
  lat: number,
  lng: number,
  radiusDeg = 1.1,
  segments = 48
): number[][] {
  const pts: number[][] = [];
  const latScale = 1 / Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push([
      lng + Math.cos(a) * radiusDeg * latScale,
      lat + Math.sin(a) * radiusDeg * 0.85,
    ]);
  }
  return pts;
}

const ESRI =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const KIND_COLOR: Record<TimelineAsset["kind"], string> = {
  tanker: "#ffb454",
  ship: "#e8eef5",
  plane: "#39d3f5",
  military: "#ff5c5c",
};

function makeMarkerEl(
  kind: TimelineAsset["kind"],
  heading: number,
  label: string
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.style.width = "18px";
  wrap.style.height = "18px";
  wrap.style.display = "flex";
  wrap.style.alignItems = "center";
  wrap.style.justifyContent = "center";
  wrap.title = label;

  const el = document.createElement("div");
  el.style.width = kind === "plane" ? "10px" : "12px";
  el.style.height = kind === "plane" ? "14px" : "7px";
  el.style.background = KIND_COLOR[kind];
  el.style.border = "1px solid rgba(255,255,255,0.55)";
  el.style.boxShadow = `0 0 8px ${KIND_COLOR[kind]}88`;
  el.style.borderRadius = kind === "plane" ? "2px 2px 40% 40%" : "2px";
  el.style.transform = `rotate(${heading}deg)`;
  el.style.transition = "transform 120ms linear, opacity 200ms ease";
  wrap.appendChild(el);
  wrap.dataset.kind = kind;
  return wrap;
}

export default function TacticalView({
  worldModel,
  epicenter,
  detections = [],
  vesselCount = 0,
  visible = false,
  eventTitle,
  timeline = null,
  playbackT = null,
}: TacticalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(new Map<string, Marker>());
  const [ready, setReady] = useState(false);
  const [utc, setUtc] = useState("");
  const lastVisible = useRef(false);

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
      // Neutral start — never hardcode Hormuz; flyTo epicenter when known
      center: [0, 20],
      zoom: 1.8,
      attributionControl: { compact: true },
      pixelRatio: Math.min(2, window.devicePixelRatio || 1),
    });
    mapRef.current = map;
    map.on("load", () => setReady(true));
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Resize + cinematic fly when becoming visible
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    if (visible && !lastVisible.current) {
      map.resize();
      if (epicenterNode) {
        // Start wide then push in
        map.jumpTo({
          center: [epicenterNode.lng, epicenterNode.lat],
          zoom: 4.2,
        });
        map.flyTo({
          center: [epicenterNode.lng, epicenterNode.lat],
          zoom: 7.4,
          duration: 1400,
          essential: true,
          curve: 1.2,
        });
      }
    }
    lastVisible.current = visible;

    if (!visible) return;
    const ro = new ResizeObserver(() => map.resize());
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [visible, ready, epicenterNode]);

  // AOI geofence
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const sourceId = "aoi";

    if (!epicenterNode) {
      if (map.getLayer("aoi-line")) map.removeLayer("aoi-line");
      if (map.getLayer("aoi-fill")) map.removeLayer("aoi-fill");
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      return;
    }

    const poly = circlePolygon(epicenterNode.lat, epicenterNode.lng);
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
        paint: { "fill-color": "#ff5c5c", "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: "aoi-line",
        type: "line",
        source: sourceId,
        paint: {
          "line-color": "#ff5c5c",
          "line-width": 1.5,
          "line-dasharray": [2, 1.5],
        },
      });
    }
  }, [epicenterNode, ready]);

  // Real timeline assets as markers (diff by id)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !visible) return;

    const t = playbackT ?? 0.2;
    const seen = new Set<string>();

    const assets = timeline?.assets ?? [];
    if (assets.length) {
      // Prefer sea assets near epicenter for tactical readability
      const near = assets.filter((a) => {
        if (a.kind === "plane") return false;
        const pos = sampleAssetPosition(a, Math.max(a.spawn_t, t));
        if (!pos || !epicenterNode) return true;
        const dLat = pos.lat - epicenterNode.lat;
        const dLng = pos.lng - epicenterNode.lng;
        return Math.hypot(dLat, dLng) < 4.5;
      });

      for (const asset of near) {
        const opacity = sampleAssetOpacity(asset, t);
        if (opacity <= 0) continue;
        const pos = sampleAssetPosition(asset, t);
        if (!pos) continue;
        seen.add(asset.id);
        const heading = sampleAssetHeading(asset, t);
        const existing = markersRef.current.get(asset.id);
        if (existing) {
          existing.setLngLat([pos.lng, pos.lat]);
          const el = existing.getElement();
          const inner = el.firstElementChild as HTMLElement | null;
          if (inner) {
            inner.style.transform = `rotate(${heading}deg)`;
            inner.style.opacity = String(opacity);
          }
        } else {
          const el = makeMarkerEl(
            asset.kind,
            heading,
            asset.label ?? asset.kind
          );
          el.style.opacity = "0";
          const marker = new maplibregl.Marker({ element: el })
            .setLngLat([pos.lng, pos.lat])
            .addTo(map);
          markersRef.current.set(asset.id, marker);
          requestAnimationFrame(() => {
            el.style.transition = "opacity 280ms ease";
            el.style.opacity = String(opacity);
          });
        }
      }
    } else if (epicenterNode && vesselCount > 0) {
      // Fallback scatter only if no timeline
      for (let i = 0; i < Math.min(vesselCount, 14); i++) {
        const id = `fallback-${i}`;
        seen.add(id);
        if (markersRef.current.has(id)) continue;
        const ang = (i / Math.max(vesselCount, 1)) * Math.PI * 2;
        const lat =
          epicenterNode.lat + Math.cos(ang) * (0.35 + (i % 3) * 0.15);
        const lng =
          epicenterNode.lng + Math.sin(ang) * (0.45 + (i % 3) * 0.2);
        const el = makeMarkerEl("tanker", (ang * 180) / Math.PI, `Vessel ${i + 1}`);
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(map);
        markersRef.current.set(id, marker);
      }
    }

    // Remove stale
    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
  }, [
    timeline,
    playbackT,
    ready,
    visible,
    epicenterNode,
    vesselCount,
  ]);

  const detectionRows =
    detections.length > 0
      ? detections
      : vesselCount > 0
        ? [
            {
              id: "tracked",
              label: "ASSETS IN AOI",
              value: String(vesselCount),
              tone: "warn" as const,
            },
          ]
        : [];

  return (
    <div
      className="tactical-stage absolute inset-0"
      style={{
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 600ms ease-out",
        zIndex: visible ? 2 : 0,
      }}
      aria-hidden={!visible}
    >
      <div className="tactical-fallback" aria-hidden="true" />
      <div ref={containerRef} className="tactical-map h-full w-full" />

      <div className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] text-white/70">
        <div>
          {epicenterNode
            ? `${epicenterNode.lat.toFixed(4)}°  ${epicenterNode.lng.toFixed(4)}°`
            : "—"}
        </div>
        <div className="text-white/45">{utc}</div>
      </div>

      <div className="pointer-events-none absolute right-3 top-3 max-w-[220px]">
        <div className="panel px-3 py-2">
          <p className="eyebrow mb-2">Detections</p>
          <AnimatePresence mode="popLayout">
            {detectionRows.map((d) => (
              <motion.div
                key={d.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
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
          {detectionRows.length === 0 && (
            <p className="text-[11px] text-white/35">Awaiting detections…</p>
          )}
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
