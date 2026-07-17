/**
 * Aviation provider — chooses live (ADSB.lol) or replay, and NEVER throws.
 *
 * ADSB.lol needs no key, so live is attempted whenever LIVE_TRANSPORT_ENABLED === "true"
 * and replay is not forced. Any error/timeout/rate-limit falls back to replay with an
 * explanatory status. A provider is NEVER labelled "live" when fixtures are used.
 */

import type { LiveRegion } from "../regions";
import type { LiveTransportAsset, ProviderStatus } from "../types";
import { getReplayAircraft } from "./replay";

export interface AircraftResult {
  assets: LiveTransportAsset[];
  status: ProviderStatus;
}

function liveEnabled(): boolean {
  return process.env.LIVE_TRANSPORT_ENABLED === "true";
}

export async function getAircraft(
  region: LiveRegion,
  opts: { replay?: boolean } = {}
): Promise<AircraftResult> {
  const forceReplay = Boolean(opts.replay);

  if (forceReplay || !liveEnabled()) {
    const replay = getReplayAircraft(region);
    replay.status.message = forceReplay
      ? "Replay forced (replay=1) — fixtures, not live ADSB.lol"
      : "LIVE_TRANSPORT_ENABLED!=true — replay aviation";
    return replay;
  }

  try {
    const { fetchAdsbAircraft } = await import("./adsb-lol");
    const assets = await fetchAdsbAircraft(region);
    return {
      assets,
      status: {
        provider: "adsb-lol",
        mode: "live",
        connected: true,
        lastUpdatedAt: new Date().toISOString(),
        itemCount: assets.length,
        message: "Live ADSB.lol — ODbL",
      },
    };
  } catch (err) {
    const replay = getReplayAircraft(region);
    replay.status.message = `ADSB.lol unavailable (${(err as Error).message}) — replay aviation`;
    return replay;
  }
}
