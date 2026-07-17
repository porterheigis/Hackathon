/**
 * Live-transport service — assembles a LiveTransportSnapshot for a region.
 *
 * Runs the maritime and aviation providers INDEPENDENTLY: one may be live while the other
 * is replay. Each provider never throws (it falls back to replay internally), so the
 * snapshot always resolves. The whole snapshot is cached for LIVE_TRANSPORT_CACHE_SECONDS
 * so we don't reconnect/refetch on every render or poll.
 *
 * The browser only ever reaches this via /api/live-transport, keeping the AISStream key
 * server-side.
 */

import { defaultCacheSeconds, getCached, setCached } from "./cache";
import { getAircraft } from "./aviation/provider";
import { getVessels } from "./maritime/provider";
import { resolveRegion } from "./regions";
import type { LiveTransportSnapshot } from "./types";

export async function getTransportSnapshot(
  regionId?: string | null,
  opts: { replay?: boolean } = {}
): Promise<LiveTransportSnapshot> {
  const region = resolveRegion(regionId);
  const replay = Boolean(opts.replay);

  const cacheKey = `snapshot:${region.id}:${replay ? "replay" : "live"}`;
  const cached = getCached<LiveTransportSnapshot>(cacheKey);
  if (cached) return cached;

  // Providers fail independently — run both, neither throws.
  const [vessels, aircraft] = await Promise.all([
    getVessels(region, { replay }),
    getAircraft(region, { replay }),
  ]);

  const now = new Date();
  const cacheSeconds = defaultCacheSeconds();
  const bucket = cacheSeconds > 0 ? Math.floor(now.getTime() / (cacheSeconds * 1000)) : now.getTime();

  const snapshot: LiveTransportSnapshot = {
    id: `${region.id}-${bucket}`,
    regionId: region.id,
    capturedAt: now.toISOString(),
    vessels: vessels.assets,
    aircraft: aircraft.assets,
    providers: {
      maritime: vessels.status,
      aviation: aircraft.status,
    },
  };

  setCached(cacheKey, snapshot);
  return snapshot;
}
