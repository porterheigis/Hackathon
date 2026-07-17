/**
 * Build a cinematic SimTimeline from sim results + world model.
 * Attached server-side so the client plays back "the future Akash computed."
 */

import type {
  DetectionRow,
  PriceTicker,
  ScenarioMatch,
  SimResult,
  SimTimeline,
  TimelineAsset,
  TimelineEvent,
  TimelinePhase,
  TimelineWaypoint,
  WorldEdge,
  WorldModel,
} from "./types";

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function offsetMidpoint(
  a: TimelineWaypoint,
  b: TimelineWaypoint,
  offsetDeg: number,
  sign = 1
): TimelineWaypoint {
  const midLat = (a.lat + b.lat) / 2;
  const midLng = (a.lng + b.lng) / 2;
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * offsetDeg * sign;
  const ny = (dx / len) * offsetDeg * sign;
  return { lat: midLat + ny, lng: midLng + nx, alt: a.alt };
}

function nodeCoords(
  wm: WorldModel,
  id: string
): TimelineWaypoint | null {
  const n = wm.nodes.find((x) => x.id === id);
  if (!n) return null;
  return { lat: n.lat, lng: n.lng };
}

function edgeWaypoints(
  wm: WorldModel,
  edge: WorldEdge,
  alt?: number
): TimelineWaypoint[] | null {
  const a = nodeCoords(wm, edge.from);
  const b = nodeCoords(wm, edge.to);
  if (!a || !b) return null;
  return [
    { ...a, alt },
    { ...b, alt },
  ];
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BuildTimelineOpts {
  sim: SimResult;
  worldModel: WorldModel;
  scenario: ScenarioMatch;
  disruptedEdges: string[];
  selectedOutcomes: string[];
  short?: boolean;
}

export function buildSimTimeline(opts: BuildTimelineOpts): SimTimeline {
  const {
    sim,
    worldModel,
    scenario,
    disruptedEdges,
    selectedOutcomes,
    short = false,
  } = opts;

  const severity = scenario.severity;
  const duration_ms = short
    ? 15000
    : Math.round(lerp(30000, 45000, Math.min(1, Math.max(0, severity))));
  const sim_days = 14;
  const epicenter = sim.epicenter;
  const epi = nodeCoords(worldModel, epicenter);
  const rand = mulberry32(hashSeed(sim.run_id + epicenter));

  const wantsAir = selectedOutcomes.includes("air_travel");
  const isConflict =
    scenario.disruption_type === "blockade" ||
    scenario.disruption_type === "conflict" ||
    scenario.disruption_type === "military" ||
    severity >= 0.85;

  const phases: TimelinePhase[] = [
    {
      id: "strike",
      start: 0,
      end: 0.17,
      caption: `T+0 — Disruption at ${scenario.event.title.split(" ").slice(0, 4).join(" ")}…`,
      sim_day_start: 0,
      sim_day_end: 1,
    },
    {
      id: "cascade",
      start: 0.17,
      end: 0.44,
      caption: "T+2d — Shock propagates through supply corridors",
      sim_day_start: 1,
      sim_day_end: 4,
    },
    {
      id: "adapt",
      start: 0.44,
      end: 0.72,
      caption: isConflict
        ? "T+6d — Reroutes open · military assets deploy"
        : "T+6d — Traffic reroutes around the chokepoint",
      sim_day_start: 4,
      sim_day_end: 9,
    },
    {
      id: "impact",
      start: 0.72,
      end: 1,
      caption: "T+10d — Markets price the new reality",
      sim_day_start: 9,
      sim_day_end: sim_days,
    },
  ];

  const disrupted = new Set(disruptedEdges);
  const seaEdges = worldModel.edges.filter(
    (e) => (e.lane_type ?? "sea") === "sea"
  );
  const airEdges = worldModel.edges.filter((e) => e.lane_type === "air");
  const hotSea = seaEdges.filter(
    (e) =>
      disrupted.has(e.id) ||
      e.from === epicenter ||
      e.to === epicenter ||
      sim.propagation_order.includes(e.from) ||
      sim.propagation_order.includes(e.to)
  );
  const hotAir = airEdges.filter(
    (e) =>
      disrupted.has(e.id) ||
      e.from === epicenter ||
      e.to === epicenter ||
      wantsAir
  );

  const assets: TimelineAsset[] = [];
  let assetIdx = 0;

  const pushShip = (
    edge: WorldEdge,
    behavior: TimelineAsset["behavior"],
    kind: "ship" | "tanker",
    spawn: number,
    waypoints: TimelineWaypoint[],
    speed: number
  ) => {
    assets.push({
      id: `asset-${assetIdx++}`,
      kind,
      edge_id: edge.id,
      waypoints,
      spawn_t: spawn,
      speed,
      behavior,
      label: kind === "tanker" ? "Tanker" : "Vessel",
    });
  };

  // Transit vessels on hot sea lanes
  for (const edge of hotSea.slice(0, 14)) {
    const base = edgeWaypoints(worldModel, edge, 0.01);
    if (!base) continue;
    const traffic = edge.traffic ?? 0.5;
    const count = Math.max(1, Math.min(4, Math.round(1 + traffic * 3)));
    const isOil =
      edge.commodity === "crude" || edge.commodity === "lng";
    for (let i = 0; i < count; i++) {
      const spawn = 0.02 + rand() * 0.35 + i * 0.03;
      const queueing = disrupted.has(edge.id);
      if (queueing && epi) {
        // Approach then queue near epicenter
        const approach: TimelineWaypoint[] = [
          base[0],
          {
            lat: lerp(base[0].lat, epi.lat, 0.7),
            lng: lerp(base[0].lng, epi.lng, 0.7),
            alt: 0.01,
          },
          {
            lat: epi.lat + (rand() - 0.5) * 1.4,
            lng: epi.lng + (rand() - 0.5) * 1.4,
            alt: 0.01,
          },
        ];
        pushShip(
          edge,
          "queue",
          isOil ? "tanker" : "ship",
          spawn,
          approach,
          0.35 + rand() * 0.2
        );
      } else {
        pushShip(
          edge,
          "transit",
          isOil ? "tanker" : "ship",
          spawn,
          base,
          0.55 + rand() * 0.35
        );
      }
    }
  }

  // Reroute vessels (adapt phase) — detour midpoints
  for (const edge of hotSea.filter((e) => disrupted.has(e.id)).slice(0, 8)) {
    const base = edgeWaypoints(worldModel, edge, 0.01);
    if (!base) continue;
    const detour = [
      base[0],
      offsetMidpoint(base[0], base[1], 8 + rand() * 6, rand() > 0.5 ? 1 : -1),
      offsetMidpoint(base[0], base[1], 12 + rand() * 4, rand() > 0.5 ? 1 : -1),
      base[1],
    ];
    pushShip(
      edge,
      "reroute",
      edge.commodity === "crude" ? "tanker" : "ship",
      0.44 + rand() * 0.2,
      detour,
      0.4 + rand() * 0.25
    );
  }

  // Planes on air corridors
  if (wantsAir || hotAir.length) {
    for (const edge of (hotAir.length ? hotAir : airEdges).slice(0, 10)) {
      const base = edgeWaypoints(worldModel, edge, 0.22);
      if (!base) continue;
      const thinning = disrupted.has(edge.id) || wantsAir;
      const count = thinning ? 1 : 2;
      for (let i = 0; i < count; i++) {
        assets.push({
          id: `asset-${assetIdx++}`,
          kind: "plane",
          edge_id: edge.id,
          waypoints: base,
          spawn_t: 0.05 + rand() * (thinning ? 0.25 : 0.5),
          speed: thinning ? 0.25 + rand() * 0.15 : 0.7 + rand() * 0.25,
          behavior: thinning ? "queue" : "transit",
          label: "Flight",
        });
      }
    }
  }

  // Military deploy to epicenter
  if (isConflict && epi) {
    const origins = worldModel.nodes
      .filter(
        (n) =>
          n.id !== epicenter &&
          (n.type === "hub" || n.type === "port" || n.type === "chokepoint")
      )
      .slice(0, 5);
    for (let i = 0; i < Math.min(5, origins.length); i++) {
      const o = origins[i];
      assets.push({
        id: `asset-${assetIdx++}`,
        kind: "military",
        waypoints: [
          { lat: o.lat, lng: o.lng, alt: 0.08 },
          {
            lat: lerp(o.lat, epi.lat, 0.5),
            lng: lerp(o.lng, epi.lng, 0.5),
            alt: 0.12,
          },
          { lat: epi.lat + (rand() - 0.5) * 0.8, lng: epi.lng + (rand() - 0.5) * 0.8, alt: 0.05 },
        ],
        spawn_t: 0.48 + i * 0.04,
        speed: 0.55 + rand() * 0.2,
        behavior: "deploy",
        label: "Military",
      });
    }
  }

  const events: TimelineEvent[] = [
    { t: 0.05, kind: "lane_freeze", payload: { edges: disruptedEdges } },
    {
      t: 0.22,
      kind: "tactical_cutaway",
      payload: { duration: 0.12 },
    },
    { t: 0.34, kind: "tactical_end" },
    {
      t: 0.2,
      kind: "camera",
      payload: { mode: "strike", altitude: 1.4 },
    },
    {
      t: 0.35,
      kind: "camera",
      payload: { mode: "cascade", altitude: 1.8 },
    },
    {
      t: 0.5,
      kind: "camera",
      payload: { mode: "adapt", altitude: 2.2 },
    },
    {
      t: 0.78,
      kind: "camera",
      payload: { mode: "impact", altitude: 2.6 },
    },
  ];

  const tickers: PriceTicker[] = sim.tickers ?? [];
  tickers.forEach((tk, i) => {
    events.push({
      t: 0.72 + (i / Math.max(1, tickers.length)) * 0.22,
      kind: "ticker_pop",
      payload: { node_id: tk.node_id, label: tk.label, delta_pct: tk.delta_pct },
    });
  });

  const detections: DetectionRow[] = sim.detections ?? [];
  detections.forEach((d, i) => {
    events.push({
      t: 0.24 + i * 0.03,
      kind: "detection",
      payload: { id: d.id, label: d.label, value: d.value, tone: d.tone },
    });
  });

  events.sort((a, b) => a.t - b.t);

  return {
    duration_ms,
    sim_days,
    phases,
    assets,
    events,
    epicenter,
    severity,
  };
}

/** Interpolate asset position at normalized playback time t ∈ [0,1] */
export function sampleAssetPosition(
  asset: TimelineAsset,
  t: number
): TimelineWaypoint | null {
  if (t < asset.spawn_t) return null;
  const local = Math.min(1, (t - asset.spawn_t) * asset.speed);
  const pts = asset.waypoints;
  if (pts.length === 0) return null;
  if (pts.length === 1) return pts[0];

  // Queue behavior: ease-out and hold near end
  let u = local;
  if (asset.behavior === "queue") {
    u = 1 - Math.pow(1 - Math.min(1, local * 1.2), 2);
    u = Math.min(0.92, u);
  } else if (asset.behavior === "deploy") {
    u = Math.min(1, local * 1.1);
  }

  const seg = u * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = pts[i];
  const b = pts[i + 1];
  return {
    lat: lerp(a.lat, b.lat, f),
    lng: lerp(a.lng, b.lng, f),
    alt: lerp(a.alt ?? 0.01, b.alt ?? 0.01, f),
  };
}

/** Heading in degrees (0 = north) along the asset path at time t */
export function sampleAssetHeading(
  asset: TimelineAsset,
  t: number
): number {
  const a = sampleAssetPosition(asset, t);
  const b = sampleAssetPosition(asset, Math.min(1, t + 0.002));
  if (!a || !b) return 0;
  const dLat = b.lat - a.lat;
  const dLng = b.lng - a.lng;
  if (Math.abs(dLat) < 1e-9 && Math.abs(dLng) < 1e-9) return 0;
  return (Math.atan2(dLng, dLat) * 180) / Math.PI;
}

/** 0→1 fade in over ~4% of timeline after spawn */
export function sampleAssetOpacity(asset: TimelineAsset, t: number): number {
  if (t < asset.spawn_t) return 0;
  const fade = 0.04;
  return Math.min(1, (t - asset.spawn_t) / fade);
}

/** Continuous camera spline for cinematic playback */
export function sampleCamera(
  t: number,
  epicenter: { lat: number; lng: number }
): { lat: number; lng: number; altitude: number } {
  // Piecewise smooth: strike → cascade → adapt → impact
  const ease = (x: number) => x * x * (3 - 2 * x);
  let altitude: number;
  let lngOffset: number;
  if (t < 0.17) {
    const u = ease(t / 0.17);
    altitude = lerp(1.55, 1.35, u);
    lngOffset = 0;
  } else if (t < 0.44) {
    const u = ease((t - 0.17) / 0.27);
    altitude = lerp(1.35, 1.85, u);
    lngOffset = lerp(0, 14, u);
  } else if (t < 0.72) {
    const u = ease((t - 0.44) / 0.28);
    altitude = lerp(1.85, 2.25, u);
    lngOffset = lerp(14, -16, u);
  } else {
    const u = ease((t - 0.72) / 0.28);
    altitude = lerp(2.25, 2.65, u);
    lngOffset = lerp(-16, 0, u);
  }
  return {
    lat: epicenter.lat,
    lng: epicenter.lng + lngOffset,
    altitude,
  };
}

export function phaseAt(timeline: SimTimeline, t: number): TimelinePhase {
  return (
    timeline.phases.find((p) => t >= p.start && t < p.end) ??
    timeline.phases[timeline.phases.length - 1]
  );
}

export function simDayAt(timeline: SimTimeline, t: number): number {
  const phase = phaseAt(timeline, t);
  const span = phase.end - phase.start || 1;
  const local = (t - phase.start) / span;
  return lerp(phase.sim_day_start, phase.sim_day_end, local);
}

export function formatSimClock(day: number): string {
  const d = Math.floor(day);
  const frac = day - d;
  const hours = Math.floor(frac * 24);
  const mins = Math.floor((frac * 24 - hours) * 60);
  return `T+${d}d ${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}
