/**
 * Maritime replay provider — deterministic fixture playback.
 *
 * Loads data/live-replay/{region}-vessels.json and advances each vessel by dead-reckoning
 * from its heading + speed over `elapsedSeconds`. Movement is a PURE function of
 * elapsedSeconds: the same elapsed always yields the same positions (this is what makes
 * the pipeline reproducible in replay). Positions are clamped inside the region bounds.
 *
 * These fixtures are FICTIONALIZED — no real vessel identities, no cargo claims.
 */

import { readFileSync } from "fs";
import path from "path";
import type { LiveRegion } from "../regions";
import { capAssets, filterStale } from "../normalize";
import type { LiveTransportAsset, ProviderStatus } from "../types";

/** Fixed epoch for replay timestamps (keeps ageSeconds/timestamps deterministic). */
export const REPLAY_EPOCH_ISO = "2026-01-01T00:00:00.000Z";
/** Movement loops over a short window so demo animation stays inside the region. */
export const REPLAY_LOOP_SECONDS = 120;
export const MAX_VESSELS = 100;
/** Vessel positions older than this (seconds) are considered stale and dropped. */
const VESSEL_MAX_AGE_SECONDS = 3600;

interface RawVessel {
  id: string;
  displayName?: string;
  lat: number;
  lon: number;
  headingDegrees: number | null;
  speedKnots: number | null;
  category?: string;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Dead-reckon a base position forward by elapsedSeconds. Pure. */
export function deadReckon(
  lat: number,
  lon: number,
  headingDegrees: number | null,
  speedKnots: number | null,
  elapsedSeconds: number,
  region: LiveRegion
): { lat: number; lon: number } {
  if (headingDegrees == null || speedKnots == null || speedKnots <= 0) {
    return { lat, lon };
  }
  const distanceNm = speedKnots * (elapsedSeconds / 3600);
  const hdg = (headingDegrees * Math.PI) / 180;
  const dLat = (distanceNm / 60) * Math.cos(hdg);
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLon = (distanceNm / 60) * (Math.sin(hdg) / cosLat);
  const { south, west, north, east } = region.bounds;
  return {
    lat: clamp(Math.round((lat + dLat) * 1e4) / 1e4, south, north),
    lon: clamp(Math.round((lon + dLon) * 1e4) / 1e4, west, east),
  };
}

export function loadVesselFixtures(region: LiveRegion): RawVessel[] {
  const p = path.join(process.cwd(), "data", "live-replay", `${region.id}-vessels.json`);
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as RawVessel[];
  } catch {
    return [];
  }
}

/** Build LiveTransportAssets from raw fixtures. Pure given (elapsedSeconds, now). */
export function buildReplayVessels(
  raws: RawVessel[],
  region: LiveRegion,
  elapsedSeconds: number,
  now: Date
): LiveTransportAsset[] {
  return raws.map((r) => {
    const moved = deadReckon(r.lat, r.lon, r.headingDegrees, r.speedKnots, elapsedSeconds, region);
    const ageSeconds = hash(r.id) % 45; // deterministic 0–44s freshness
    const ts = new Date(now.getTime() - ageSeconds * 1000).toISOString();
    return {
      id: r.id,
      type: "vessel",
      latitude: moved.lat,
      longitude: moved.lon,
      headingDegrees: r.headingDegrees,
      speedKnots: r.speedKnots,
      altitudeFeet: null,
      callsign: null,
      displayName: r.displayName ?? r.id,
      registration: null,
      category: r.category ?? "vessel",
      destination: null,
      timestamp: ts,
      ageSeconds,
      source: "replay",
      dataMode: "replay",
    };
  });
}

function defaultElapsedSeconds(): number {
  return Math.floor((Date.now() / 1000) % REPLAY_LOOP_SECONDS);
}

export interface ReplayOpts {
  elapsedSeconds?: number;
  now?: Date;
}

export function getReplayVessels(
  region: LiveRegion,
  opts: ReplayOpts = {}
): { assets: LiveTransportAsset[]; status: ProviderStatus } {
  const now = opts.now ?? new Date();
  const elapsed = opts.elapsedSeconds ?? defaultElapsedSeconds();
  const built = buildReplayVessels(loadVesselFixtures(region), region, elapsed, now);
  const assets = capAssets(filterStale(built, VESSEL_MAX_AGE_SECONDS), MAX_VESSELS);
  return {
    assets,
    status: {
      provider: "aisstream-replay",
      mode: "replay",
      connected: true,
      lastUpdatedAt: now.toISOString(),
      itemCount: assets.length,
      message: "Replay fixtures (fictionalized) — set AISSTREAM_API_KEY for live maritime",
    },
  };
}
