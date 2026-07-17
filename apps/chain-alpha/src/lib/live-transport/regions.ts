/**
 * Small, predefined geographic regions for live-transport queries.
 *
 * These bounds are intentionally limited — ChainAlpha NEVER requests global live traffic.
 * AISStream subscriptions and ADSB.lol point/radius queries are always scoped to one of
 * these regions (default: taiwan).
 */

export interface RegionBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface LiveRegion {
  id: string;
  label: string;
  bounds: RegionBounds;
}

export const LIVE_REGIONS = {
  taiwan: {
    id: "taiwan",
    label: "Taiwan and East Asia",
    bounds: { south: 18, west: 112, north: 36, east: 134 },
  },
  redSea: {
    id: "red-sea",
    label: "Red Sea and Gulf of Aden",
    bounds: { south: 8, west: 32, north: 31, east: 52 },
  },
} as const satisfies Record<string, LiveRegion>;

export type LiveRegionId = (typeof LIVE_REGIONS)[keyof typeof LIVE_REGIONS]["id"];

export const DEFAULT_REGION_ID: LiveRegionId = "taiwan";

/** Map a raw region string (query param, scenario worldModelId) to a known region. */
export function resolveRegion(input?: string | null): LiveRegion {
  if (!input) return LIVE_REGIONS.taiwan;
  const norm = input.toLowerCase();
  if (norm === "red-sea" || norm === "redsea" || norm === "red_sea") {
    return LIVE_REGIONS.redSea;
  }
  return LIVE_REGIONS.taiwan;
}

/** Center point + query radius (nautical miles) for a point/radius API like ADSB.lol. */
export function regionCenterRadiusNm(region: LiveRegion): {
  lat: number;
  lon: number;
  radiusNm: number;
} {
  const { south, west, north, east } = region.bounds;
  const lat = (south + north) / 2;
  const lon = (west + east) / 2;
  // Approximate the bounding box with a radius (1° lat ≈ 60 nm), capped at the
  // ADSB.lol maximum of 250 nm to stay within a bounded, non-global query.
  const latSpanNm = ((north - south) / 2) * 60;
  const lonSpanNm = ((east - west) / 2) * 60 * Math.cos((lat * Math.PI) / 180);
  const radiusNm = Math.min(250, Math.round(Math.max(latSpanNm, lonSpanNm)));
  return { lat, lon, radiusNm };
}

/** Is a coordinate inside the region bounds? */
export function inBounds(
  bounds: RegionBounds,
  lat: number,
  lon: number
): boolean {
  return (
    lat >= bounds.south &&
    lat <= bounds.north &&
    lon >= bounds.west &&
    lon <= bounds.east
  );
}
