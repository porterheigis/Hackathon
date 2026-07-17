/**
 * ADSB.lol live aviation provider (FREE, open, NO key, ODbL 1.0 — see README).
 *
 * Fetches the v2 point/radius endpoint scoped to the region center + radius (≤ 250 nm), with
 * a strict AbortController timeout and a User-Agent header. Filters invalid coordinates,
 * normalizes, caps ~60. On rate-limit / network error / incompatible shape it THROWS so the
 * provider falls back to replay. Responses are cached to respect the dynamic rate limits.
 *
 * Attribution required by downstream UI: "ADSB.lol — ODbL".
 */

import type { LiveRegion } from "../regions";
import { regionCenterRadiusNm } from "../regions";
import {
  capAssets,
  dedupeByKey,
  filterStale,
  normalizeAdsbAircraft,
} from "../normalize";
import { getCached, setCached } from "../cache";
import type { LiveTransportAsset } from "../types";

const REQUEST_TIMEOUT_MS = 5000;
const MAX_AIRCRAFT = 60;
const MAX_AGE_SECONDS = 3600;
const USER_AGENT = "ChainAlpha/1.0 (supply-chain research demo; +https://github.com/)";

interface AdsbResponse {
  ac?: unknown[];
}

export async function fetchAdsbAircraft(
  region: LiveRegion
): Promise<LiveTransportAsset[]> {
  const cacheKey = `adsb:${region.id}`;
  const cached = getCached<LiveTransportAsset[]>(cacheKey);
  if (cached) return cached;

  const { lat, lon, radiusNm } = regionCenterRadiusNm(region);
  const url = `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${radiusNm}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
  } catch (err) {
    throw new Error(`ADSB.lol request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) throw new Error("ADSB.lol rate limited (429)");
  if (!res.ok) throw new Error(`ADSB.lol HTTP ${res.status}`);

  let json: AdsbResponse;
  try {
    json = (await res.json()) as AdsbResponse;
  } catch {
    throw new Error("ADSB.lol returned non-JSON");
  }
  if (!json || !Array.isArray(json.ac)) {
    throw new Error("ADSB.lol response missing 'ac' array");
  }

  const now = new Date();
  const normalized: LiveTransportAsset[] = [];
  for (const raw of json.ac) {
    const asset = normalizeAdsbAircraft(raw, now);
    if (asset) normalized.push(asset);
  }
  const assets = capAssets(
    filterStale(dedupeByKey(normalized), MAX_AGE_SECONDS),
    MAX_AIRCRAFT
  );
  if (assets.length === 0) throw new Error("ADSB.lol returned no valid aircraft");

  setCached(cacheKey, assets);
  return assets;
}
