/**
 * Provider-neutral live-transport data model.
 *
 * Every maritime/aviation provider (AISStream, ADSB.lol, replay fixtures) normalizes
 * its raw responses into these types. UI components and the orchestrator only ever see
 * these shapes — provider-specific payloads never leak past the adapter boundary.
 *
 * Free-access gate (verified during implementation — see README "Live transport data"):
 *  - AISStream: free, no credit card (GitHub sign-in issues the key), BETA / best-effort.
 *    Requires a server-side AISSTREAM_API_KEY → replay by default, live only when set.
 *  - ADSB.lol: free, open, no key, ODbL 1.0. Dynamic rate limits; a key MAY be required
 *    in the future per its docs → always retains a replay fallback.
 */

export type TransportAssetType = "vessel" | "aircraft";

export type TransportDataMode = "live" | "replay" | "unavailable";

export type TransportSource = "aisstream" | "adsb-lol" | "replay";

export interface LiveTransportAsset {
  id: string;
  type: TransportAssetType;
  latitude: number;
  longitude: number;
  headingDegrees: number | null;
  speedKnots: number | null;
  altitudeFeet: number | null;
  callsign: string | null;
  displayName: string | null;
  registration: string | null;
  category: string | null;
  destination: string | null;
  timestamp: string;
  ageSeconds: number;
  source: TransportSource;
  dataMode: TransportDataMode;
}

export interface ProviderStatus {
  provider: string;
  mode: TransportDataMode;
  connected: boolean;
  lastUpdatedAt: string | null;
  itemCount: number;
  message?: string;
}

export interface LiveTransportSnapshot {
  id: string;
  regionId: string;
  capturedAt: string;
  vessels: LiveTransportAsset[];
  aircraft: LiveTransportAsset[];
  providers: {
    maritime: ProviderStatus;
    aviation: ProviderStatus;
  };
}

/**
 * Explainable transport-exposure output. Never invents cargo contents or capacities:
 * when vessel classes / capacity are unavailable the capacity fields are null, and
 * ranges are used instead of false precision.
 */
export interface TransportImpact {
  observedVesselsInRegion: number;
  observedAircraftInRegion: number;
  exposedVesselCount: number;
  exposedAircraftCount: number;
  estimatedMaritimeCapacityExposure: {
    min: number;
    max: number;
    unit: "TEU-equivalent";
  } | null;
  estimatedAirCapacityReductionPercent: {
    min: number;
    max: number;
  } | null;
  medianReroutingDelayDays: number | null;
  confidence: number;
  methodology: string[];
}

/** Overall snapshot data mode: live if either provider is live, else replay/unavailable. */
export function snapshotMode(snapshot: LiveTransportSnapshot): TransportDataMode {
  const m = snapshot.providers.maritime.mode;
  const a = snapshot.providers.aviation.mode;
  if (m === "live" || a === "live") return "live";
  if (m === "replay" || a === "replay") return "replay";
  return "unavailable";
}
