/**
 * Maritime provider — chooses live (AISStream) or replay, and NEVER throws.
 *
 * Replay is the default. Live is attempted only when ALL of these hold:
 *   - not forced into replay,
 *   - LIVE_TRANSPORT_ENABLED === "true",
 *   - AISSTREAM_API_KEY is present.
 * Any live error/timeout falls back to replay with an explanatory status message. A
 * provider is NEVER labelled "live" when fixtures are used.
 */

import type { LiveRegion } from "../regions";
import type { LiveTransportAsset, ProviderStatus } from "../types";
import { getReplayVessels } from "./replay";

export interface VesselResult {
  assets: LiveTransportAsset[];
  status: ProviderStatus;
}

function liveEnabled(): boolean {
  return process.env.LIVE_TRANSPORT_ENABLED === "true";
}

export async function getVessels(
  region: LiveRegion,
  opts: { replay?: boolean } = {}
): Promise<VesselResult> {
  const apiKey = process.env.AISSTREAM_API_KEY ?? "";
  const forceReplay = Boolean(opts.replay);

  if (forceReplay || !liveEnabled() || !apiKey) {
    const replay = getReplayVessels(region);
    if (forceReplay) {
      replay.status.message = "Replay forced (replay=1) — fixtures, not live AISStream";
    } else if (!apiKey) {
      replay.status.message = "No AISSTREAM_API_KEY — replay maritime (set key for live)";
    } else if (!liveEnabled()) {
      replay.status.message = "LIVE_TRANSPORT_ENABLED!=true — replay maritime";
    }
    return replay;
  }

  try {
    const { fetchAisVessels } = await import("./aisstream");
    const assets = await fetchAisVessels(region, apiKey);
    return {
      assets,
      status: {
        provider: "aisstream",
        mode: "live",
        connected: true,
        lastUpdatedAt: new Date().toISOString(),
        itemCount: assets.length,
        message: "Live AISStream (beta, best-effort)",
      },
    };
  } catch (err) {
    const replay = getReplayVessels(region);
    replay.status.message = `AISStream unavailable (${(err as Error).message}) — replay maritime`;
    return replay;
  }
}
