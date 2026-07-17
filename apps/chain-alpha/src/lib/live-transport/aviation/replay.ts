/**
 * Aviation replay provider — deterministic fixture playback.
 *
 * Loads data/live-replay/{region}-aircraft.json and advances each aircraft by
 * dead-reckoning over `elapsedSeconds` (PURE — same elapsed → same positions), clamped
 * inside the region bounds. FICTIONALIZED fixtures: no real flight identities, no cargo.
 */

import { readFileSync } from "fs";
import path from "path";
import type { LiveRegion } from "../regions";
import { capAssets, filterStale } from "../normalize";
import { deadReckon, REPLAY_LOOP_SECONDS } from "../maritime/replay";
import type { LiveTransportAsset, ProviderStatus } from "../types";

export const MAX_AIRCRAFT = 60;
const AIRCRAFT_MAX_AGE_SECONDS = 3600;

interface RawAircraft {
  id: string;
  callsign?: string;
  displayName?: string;
  registration?: string;
  lat: number;
  lon: number;
  headingDegrees: number | null;
  speedKnots: number | null;
  altitudeFeet: number | null;
  category?: string;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function loadAircraftFixtures(region: LiveRegion): RawAircraft[] {
  const p = path.join(process.cwd(), "data", "live-replay", `${region.id}-aircraft.json`);
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as RawAircraft[];
  } catch {
    return [];
  }
}

export function buildReplayAircraft(
  raws: RawAircraft[],
  region: LiveRegion,
  elapsedSeconds: number,
  now: Date
): LiveTransportAsset[] {
  return raws.map((r) => {
    const moved = deadReckon(r.lat, r.lon, r.headingDegrees, r.speedKnots, elapsedSeconds, region);
    const ageSeconds = hash(r.id) % 30; // aircraft update faster than vessels
    const ts = new Date(now.getTime() - ageSeconds * 1000).toISOString();
    return {
      id: r.id,
      type: "aircraft",
      latitude: moved.lat,
      longitude: moved.lon,
      headingDegrees: r.headingDegrees,
      speedKnots: r.speedKnots,
      altitudeFeet: r.altitudeFeet,
      callsign: r.callsign ?? null,
      displayName: r.displayName ?? r.callsign ?? r.id,
      registration: r.registration ?? null,
      category: r.category ?? null,
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

export function getReplayAircraft(
  region: LiveRegion,
  opts: ReplayOpts = {}
): { assets: LiveTransportAsset[]; status: ProviderStatus } {
  const now = opts.now ?? new Date();
  const elapsed = opts.elapsedSeconds ?? defaultElapsedSeconds();
  const built = buildReplayAircraft(loadAircraftFixtures(region), region, elapsed, now);
  const assets = capAssets(filterStale(built, AIRCRAFT_MAX_AGE_SECONDS), MAX_AIRCRAFT);
  return {
    assets,
    status: {
      provider: "adsb-lol-replay",
      mode: "replay",
      connected: true,
      lastUpdatedAt: now.toISOString(),
      itemCount: assets.length,
      message: "Replay fixtures (fictionalized) — live path uses ADSB.lol (ODbL, no key)",
    },
  };
}
