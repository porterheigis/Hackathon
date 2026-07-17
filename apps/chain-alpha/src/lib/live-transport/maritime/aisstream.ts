/**
 * AISStream live maritime provider (FREE, BETA / best-effort — see README).
 *
 * Opens a SHORT-LIVED WebSocket to wss://stream.aisstream.io/v0/stream, sends a
 * bounding-box subscription within the required 3s window, collects PositionReport
 * messages for a bounded window, normalizes/dedupes by MMSI, then closes cleanly. There is
 * NEVER a permanent or global socket. On any error/timeout the caller falls back to replay.
 *
 * The `ws` package is loaded via a guarded dynamic import so the build/replay paths never
 * require it. The API key is read from AISSTREAM_API_KEY server-side and never leaves here.
 */

import type { LiveRegion } from "../regions";
import {
  capAssets,
  dedupeByKey,
  filterStale,
  normalizeAisPositionReport,
} from "../normalize";
import type { LiveTransportAsset } from "../types";

const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
const COLLECT_WINDOW_MS = 3000; // gather messages for ~3s
const OVERALL_TIMEOUT_MS = 6000; // strict abort ceiling
const MAX_VESSELS = 100;
const MAX_AGE_SECONDS = 3600;

/**
 * Connect, subscribe, collect, close. Resolves with normalized live vessels or throws
 * (empty/timeout/error) so the provider can fall back to replay. Never rejects silently.
 */
export async function fetchAisVessels(
  region: LiveRegion,
  apiKey: string
): Promise<LiveTransportAsset[]> {
  if (!apiKey) throw new Error("AISSTREAM_API_KEY missing");

  // Guarded dynamic import — build/replay never need the ws package.
  const wsMod = (await import("ws").catch(() => null)) as
    | { default: new (url: string) => AisSocket }
    | null;
  if (!wsMod) throw new Error("ws package unavailable");
  const WebSocketImpl = wsMod.default;

  const { south, west, north, east } = region.bounds;
  const subscription = {
    APIKey: apiKey,
    BoundingBoxes: [[[south, west], [north, east]]],
    FilterMessageTypes: ["PositionReport"],
  };

  return await new Promise<LiveTransportAsset[]>((resolve, reject) => {
    const collected: LiveTransportAsset[] = [];
    let settled = false;
    let ws: AisSocket | null = null;

    const cleanup = () => {
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(overall);
      clearTimeout(collectTimer);
      cleanup();
      const now = new Date();
      const deduped = dedupeByKey(collected);
      const fresh = filterStale(deduped, MAX_AGE_SECONDS);
      // ageSeconds were computed against message time; refresh isn't needed here.
      void now;
      if (fresh.length === 0) {
        reject(new Error("AISStream returned no in-region positions in window"));
      } else {
        resolve(capAssets(fresh, MAX_VESSELS));
      }
    };
    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(overall);
      clearTimeout(collectTimer);
      cleanup();
      reject(new Error(msg));
    };

    const overall = setTimeout(() => fail("AISStream overall timeout"), OVERALL_TIMEOUT_MS);
    let collectTimer: ReturnType<typeof setTimeout> = setTimeout(() => {}, 0);
    clearTimeout(collectTimer);

    try {
      ws = new WebSocketImpl(AISSTREAM_URL);
    } catch (err) {
      fail(`AISStream connect failed: ${(err as Error).message}`);
      return;
    }

    // Must subscribe within 3s of connect or the server drops us.
    const subTimeout = setTimeout(() => {
      fail("AISStream subscribe deadline missed");
    }, 2500);

    ws.on("open", () => {
      clearTimeout(subTimeout);
      try {
        ws?.send(JSON.stringify(subscription));
      } catch (err) {
        fail(`AISStream subscribe send failed: ${(err as Error).message}`);
        return;
      }
      // After subscribing, collect for a bounded window then finish.
      collectTimer = setTimeout(finish, COLLECT_WINDOW_MS);
    });

    ws.on("message", (data: unknown) => {
      try {
        const text = typeof data === "string" ? data : String(data);
        const parsed = JSON.parse(text) as { MessageType?: string };
        if (parsed.MessageType && parsed.MessageType !== "PositionReport") return;
        const asset = normalizeAisPositionReport(parsed, region, new Date());
        if (asset) collected.push(asset);
      } catch {
        /* skip malformed frame */
      }
    });

    ws.on("error", (err: unknown) => {
      fail(`AISStream socket error: ${(err as Error)?.message ?? "unknown"}`);
    });
    ws.on("close", () => {
      // If the server closed after we collected something, treat as done.
      if (!settled && collected.length > 0) finish();
      else if (!settled) fail("AISStream closed before any data");
    });
  });
}

/** Minimal structural type for the subset of the `ws` API we use. */
interface AisSocket {
  on(event: "open", cb: () => void): void;
  on(event: "message", cb: (data: unknown) => void): void;
  on(event: "error", cb: (err: unknown) => void): void;
  on(event: "close", cb: () => void): void;
  send(data: string): void;
  close(): void;
}
