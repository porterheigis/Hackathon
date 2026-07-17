/**
 * Transparent transport-exposure heuristic.
 *
 * Given an observed snapshot and the simulated disruption (merged scenario + derived
 * node/edge statuses), decide which observed vessels/aircraft are plausibly EXPOSED and
 * produce coarse, range-based capacity estimates. This is deterministic and explainable.
 *
 * IMPORTANT (see README): positions are observations, NOT cargo manifests. We never claim a
 * vessel/aircraft is "carrying" any specific goods. "Exposed" only means the asset is near,
 * inside, or heading toward the disrupted supply geography.
 *
 * Signals combined per asset:
 *  1. Proximity to a disrupted node that sits INSIDE the observation region.
 *  2. Proximity to an "approach anchor" — a disrupted node OUTSIDE the region (e.g. Japan
 *     materials/equipment hubs) clamped to the region boundary. This is what lights up
 *     aircraft on the Japan-facing approach under the secondary shock.
 *  3. (Vessels) heading toward a nearby disrupted chokepoint within a wider corridor band.
 *  4. Position age — stale fixes are down-weighted (tighter catchment).
 */

import { inBounds, resolveRegion } from "./regions";
import type { LiveRegion } from "./regions";
import type { NetworkStatuses } from "../adapters/akash";
import { loadWorldModelById } from "../scenarios";
import type {
  IndustryModel,
  ScenarioDefinition,
  WorldModel,
  WorldNode,
} from "../types";
import type { LiveTransportAsset, LiveTransportSnapshot, TransportImpact } from "./types";

const VESSEL_CATCHMENT_NM = 130;
const AIRCRAFT_CATCHMENT_NM = 260;
const VESSEL_CORRIDOR_NM = 260;
const HEADING_TOLERANCE_DEG = 55;
const POSITION_STALE_SECONDS = 900;

const EARTH_NM = 3440.065;
const toRad = (d: number) => (d * Math.PI) / 180;

function distanceNm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_NM * Math.asin(Math.min(1, Math.sqrt(s)));
}

function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const y = Math.sin(toRad(bLon - aLon)) * Math.cos(toRad(bLat));
  const x =
    Math.cos(toRad(aLat)) * Math.sin(toRad(bLat)) -
    Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(toRad(bLon - aLon));
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function angularDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function clampToBounds(node: WorldNode, region: LiveRegion): { lat: number; lon: number } {
  const { south, west, north, east } = region.bounds;
  return {
    lat: Math.min(north, Math.max(south, node.lat)),
    lon: Math.min(east, Math.max(west, node.lng)),
  };
}

interface Center {
  lat: number;
  lon: number;
  kind: "in-region" | "approach";
}

function collectCenters(
  world: WorldModel,
  statuses: NetworkStatuses,
  region: LiveRegion
): { centers: Center[]; approachCount: number } {
  const byId = new Map(world.nodes.map((n) => [n.id, n]));
  const centers: Center[] = [];
  let approachCount = 0;
  for (const id of statuses.disrupted) {
    const node = byId.get(id);
    if (!node || typeof node.lat !== "number" || typeof node.lng !== "number") continue;
    if (inBounds(region.bounds, node.lat, node.lng)) {
      centers.push({ lat: node.lat, lon: node.lng, kind: "in-region" });
    } else {
      const anchor = clampToBounds(node, region);
      centers.push({ lat: anchor.lat, lon: anchor.lon, kind: "approach" });
      approachCount += 1;
    }
  }
  return { centers, approachCount };
}

function isExposed(
  asset: LiveTransportAsset,
  centers: Center[]
): boolean {
  if (centers.length === 0) return false;
  const stale = asset.ageSeconds > POSITION_STALE_SECONDS;
  const catchment =
    (asset.type === "vessel" ? VESSEL_CATCHMENT_NM : AIRCRAFT_CATCHMENT_NM) *
    (stale ? 0.6 : 1);

  let nearest = Infinity;
  let nearestCenter: Center | null = null;
  for (const c of centers) {
    const d = distanceNm(asset.latitude, asset.longitude, c.lat, c.lon);
    if (d < nearest) {
      nearest = d;
      nearestCenter = c;
    }
  }
  if (nearest <= catchment) return true;

  // Vessels heading toward a nearby disrupted chokepoint within a wider corridor.
  if (
    asset.type === "vessel" &&
    !stale &&
    asset.headingDegrees != null &&
    nearestCenter &&
    nearest <= VESSEL_CORRIDOR_NM
  ) {
    const brg = bearingDeg(
      asset.latitude,
      asset.longitude,
      nearestCenter.lat,
      nearestCenter.lon
    );
    if (angularDiff(asset.headingDegrees, (brg + 360) % 360) <= HEADING_TOLERANCE_DEG) {
      return true;
    }
  }
  return false;
}

export interface TransportImpactResult {
  exposedAssetIds: string[];
  impact: TransportImpact;
}

export function computeTransportImpact(
  snapshot: LiveTransportSnapshot,
  mergedScenario: ScenarioDefinition,
  statuses: NetworkStatuses,
  industry: IndustryModel
): TransportImpactResult {
  const region = resolveRegion(snapshot.regionId);
  const world =
    mergedScenario.worldModelId === industry.worldModel.name ||
    mergedScenario.worldModelId === industry.id
      ? industry.worldModel
      : loadWorldModelById(mergedScenario.worldModelId);
  const { centers, approachCount } = collectCenters(world, statuses, region);
  const secondaryApplied = approachCount > 0;

  const exposedVessels = snapshot.vessels.filter((v) => isExposed(v, centers));
  const exposedAircraft = snapshot.aircraft.filter((a) => isExposed(a, centers));
  const exposedAssetIds = [...exposedVessels, ...exposedAircraft].map((a) => a.id).sort();

  const observedVesselsInRegion = snapshot.vessels.length;
  const observedAircraftInRegion = snapshot.aircraft.length;
  const exposedVesselCount = exposedVessels.length;
  const exposedAircraftCount = exposedAircraft.length;

  // Coarse, range-only maritime capacity exposure. Positions are not manifests, so we use a
  // wide mixed-class TEU-equivalent band per observed vessel (null when nothing is exposed).
  const estimatedMaritimeCapacityExposure =
    exposedVesselCount > 0
      ? {
          min: exposedVesselCount * 1200,
          max: exposedVesselCount * 8500,
          unit: "TEU-equivalent" as const,
        }
      : null;

  // Air-freight capacity reduction: share of observed aircraft flagged, mapped to a modest
  // belly/freighter-capacity band. Range, not a point estimate.
  const airShare =
    observedAircraftInRegion > 0 ? exposedAircraftCount / observedAircraftInRegion : 0;
  const estimatedAirCapacityReductionPercent =
    exposedAircraftCount > 0
      ? {
          min: Math.max(1, Math.min(45, Math.round(airShare * 20))),
          max: Math.max(2, Math.min(60, Math.round(airShare * 40))),
        }
      : null;

  // Rerouting delay: range midpoint (worse under the secondary shock).
  const delayMin = 3.5 + (secondaryApplied ? 1.5 : 0);
  const delayMax = 6.5 + (secondaryApplied ? 2.5 : 0);
  const medianReroutingDelayDays =
    exposedVesselCount > 0 || exposedAircraftCount > 0
      ? Math.round(((delayMin + delayMax) / 2) * 10) / 10
      : null;

  // Confidence: lower under the secondary shock; down-weighted by stale positions.
  const totalObserved = observedVesselsInRegion + observedAircraftInRegion;
  const staleCount =
    snapshot.vessels.filter((v) => v.ageSeconds > POSITION_STALE_SECONDS).length +
    snapshot.aircraft.filter((a) => a.ageSeconds > POSITION_STALE_SECONDS).length;
  const stalePenalty = totalObserved > 0 ? Math.min(0.1, (staleCount / totalObserved) * 0.2) : 0;
  const confidence =
    Math.round(
      Math.max(0.3, Math.min(0.75, 0.6 - (secondaryApplied ? 0.18 : 0) - stalePenalty)) * 100
    ) / 100;

  const methodology: string[] = [
    `Observation region: ${region.label} (${observedVesselsInRegion} vessels, ${observedAircraftInRegion} aircraft in view; snapshot mode ${snapshot.providers.maritime.mode}/${snapshot.providers.aviation.mode}).`,
    `A vessel is flagged EXPOSED when it is within ${VESSEL_CATCHMENT_NM} nm of a disrupted supply node inside the region, or within ${VESSEL_CORRIDOR_NM} nm and heading (±${HEADING_TOLERANCE_DEG}°) toward the nearest disrupted chokepoint.`,
    `An aircraft is flagged EXPOSED when it is within ${AIRCRAFT_CATCHMENT_NM} nm of a disrupted supply node, or of a disrupted out-of-region hub (e.g. Japan materials/equipment) projected onto the region's approach boundary.`,
    `Position fixes older than ${POSITION_STALE_SECONDS}s are down-weighted (catchment reduced to 60%).`,
    `Maritime capacity exposure is a coarse ${exposedVesselCount > 0 ? "1,200–8,500" : "n/a"} TEU-equivalent-per-vessel band — positions are observations, NOT cargo manifests; no specific goods are inferred.`,
    `Air-freight reduction maps the exposed-aircraft share (${exposedAircraftCount}/${observedAircraftInRegion}) to a modest belly/freighter band; it is a range, not a point estimate.`,
    secondaryApplied
      ? `Secondary shock active: ${approachCount} out-of-region hub(s) disrupted — aircraft on the Japan-facing approach are added, delay range widened, confidence lowered.`
      : `Primary shock only: exposure limited to in-region disrupted nodes.`,
  ];

  return {
    exposedAssetIds,
    impact: {
      observedVesselsInRegion,
      observedAircraftInRegion,
      exposedVesselCount,
      exposedAircraftCount,
      estimatedMaritimeCapacityExposure,
      estimatedAirCapacityReductionPercent,
      medianReroutingDelayDays,
      confidence,
      methodology,
    },
  };
}
