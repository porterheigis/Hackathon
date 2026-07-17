/**
 * Pure normalizers: raw provider payloads → LiveTransportAsset.
 *
 * These functions are the ONLY place provider-specific field names appear. They are pure
 * (no I/O, no clock beyond the injected `now`) so the test suite can exercise them with
 * fixed inputs and assert deterministic output. Invalid / partial records return null and
 * are dropped by the caller — a bad position never reaches the orchestrator or the UI.
 */

import type { LiveRegion } from "./regions";
import { inBounds } from "./regions";
import type { LiveTransportAsset } from "./types";

/** Longitude/latitude sanity check. Rejects the AIS "unavailable" sentinels (91/181). */
export function isValidCoord(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    // AIS sends 91/181 when a fix is unavailable.
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 91 || lon === 181) &&
    !(lat === 0 && lon === 0)
  );
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function ageSecondsFrom(timestampMs: number | null, now: Date): number {
  if (timestampMs == null) return 0;
  const age = Math.round((now.getTime() - timestampMs) / 1000);
  return age < 0 ? 0 : age;
}

/**
 * AISStream PositionReport → LiveTransportAsset.
 * Dedupe key = MMSI. Drops records outside the region or with invalid coordinates.
 * Heading prefers TrueHeading (511 = "not available" → falls back to COG). Speed = SOG.
 */
export function normalizeAisPositionReport(
  raw: unknown,
  region: LiveRegion,
  now: Date
): LiveTransportAsset | null {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw as Record<string, unknown>;

  const meta = (msg.MetaData ?? msg.metaData ?? {}) as Record<string, unknown>;
  const body = (msg.Message ?? {}) as Record<string, unknown>;
  const pr = (body.PositionReport ?? {}) as Record<string, unknown>;

  const mmsi =
    toNum(meta.MMSI) ?? toNum(pr.UserID) ?? toNum((meta as { mmsi?: unknown }).mmsi);
  if (mmsi == null) return null;

  const lat = toNum(meta.latitude) ?? toNum(pr.Latitude);
  const lon = toNum(meta.longitude) ?? toNum(pr.Longitude);
  if (!isValidCoord(lat, lon)) return null;
  if (!inBounds(region.bounds, lat as number, lon as number)) return null;

  // TrueHeading 511 = not available; fall back to course-over-ground.
  const trueHeading = toNum(pr.TrueHeading);
  const cog = toNum(pr.Cog);
  const heading =
    trueHeading != null && trueHeading >= 0 && trueHeading < 360
      ? trueHeading
      : cog != null && cog >= 0 && cog < 360
        ? cog
        : null;

  const sog = toNum(pr.Sog);
  const speedKnots = sog != null && sog >= 0 && sog < 102.2 ? sog : null;

  const shipName =
    typeof meta.ShipName === "string" ? meta.ShipName.trim() : null;
  const timeUtc =
    typeof meta.time_utc === "string" ? Date.parse(meta.time_utc) : NaN;
  const timestampMs = Number.isFinite(timeUtc) ? timeUtc : now.getTime();

  return {
    id: `mmsi-${mmsi}`,
    type: "vessel",
    latitude: lat as number,
    longitude: lon as number,
    headingDegrees: heading,
    speedKnots,
    altitudeFeet: null,
    callsign: null,
    displayName: shipName && shipName.length > 0 ? shipName : `MMSI ${mmsi}`,
    registration: null,
    category: "vessel",
    destination: null,
    timestamp: new Date(timestampMs).toISOString(),
    ageSeconds: ageSecondsFrom(timestampMs, now),
    source: "aisstream",
    dataMode: "live",
  };
}

/**
 * ADSB.lol v2 aircraft record → LiveTransportAsset.
 * id = hex (ICAO 24-bit). Drops records with missing/invalid lat/lon.
 * altitudeFeet from alt_baro (numeric; "ground" → 0). ageSeconds from seen_pos.
 */
export function normalizeAdsbAircraft(
  raw: unknown,
  now: Date
): LiveTransportAsset | null {
  if (!raw || typeof raw !== "object") return null;
  const ac = raw as Record<string, unknown>;

  const hex = typeof ac.hex === "string" ? ac.hex.trim().toLowerCase() : null;
  if (!hex) return null;

  const lat = toNum(ac.lat);
  const lon = toNum(ac.lon);
  if (!isValidCoord(lat, lon)) return null;

  const flight = typeof ac.flight === "string" ? ac.flight.trim() : null;
  const altBaro =
    ac.alt_baro === "ground" ? 0 : toNum(ac.alt_baro);
  const gs = toNum(ac.gs);
  const track = toNum(ac.track);
  const registration = typeof ac.r === "string" ? ac.r.trim() : null;
  const acType = typeof ac.t === "string" ? ac.t.trim() : null;
  const category =
    typeof ac.category === "string" ? ac.category.trim() : null;

  const seenPos = toNum(ac.seen_pos);
  const ageSeconds = seenPos != null && seenPos >= 0 ? Math.round(seenPos) : 0;
  const timestampMs = now.getTime() - ageSeconds * 1000;

  return {
    id: `hex-${hex}`,
    type: "aircraft",
    latitude: lat as number,
    longitude: lon as number,
    headingDegrees: track != null && track >= 0 && track < 360 ? track : null,
    speedKnots: gs != null && gs >= 0 ? gs : null,
    altitudeFeet: altBaro,
    callsign: flight && flight.length > 0 ? flight : null,
    displayName: flight && flight.length > 0 ? flight : hex.toUpperCase(),
    registration: registration && registration.length > 0 ? registration : null,
    category: acType ?? category,
    destination: null,
    timestamp: new Date(timestampMs).toISOString(),
    ageSeconds,
    source: "adsb-lol",
    dataMode: "live",
  };
}

/** Keep the most-recently-seen asset per dedupe key (lowest ageSeconds wins). */
export function dedupeByKey<T extends { id: string; ageSeconds: number }>(
  items: T[]
): T[] {
  const best = new Map<string, T>();
  for (const item of items) {
    const prev = best.get(item.id);
    if (!prev || item.ageSeconds < prev.ageSeconds) best.set(item.id, item);
  }
  return [...best.values()];
}

/** Drop assets whose last position fix is older than maxAgeSeconds. */
export function filterStale<T extends { ageSeconds: number }>(
  assets: T[],
  maxAgeSeconds: number
): T[] {
  return assets.filter((a) => a.ageSeconds <= maxAgeSeconds);
}

/** Cap the number of assets (keeps the freshest first) to bound payload size. */
export function capAssets<T extends { ageSeconds: number }>(
  assets: T[],
  n: number
): T[] {
  if (assets.length <= n) return assets;
  return [...assets].sort((a, b) => a.ageSeconds - b.ageSeconds).slice(0, n);
}
