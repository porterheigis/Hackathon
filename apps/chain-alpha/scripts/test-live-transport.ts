/**
 * Offline assertions for the live-transport data layer.
 * Run standalone:  npx tsx scripts/test-live-transport.ts
 * Also invoked from scripts/test-adapters.ts so `npm run test:adapters` covers it.
 *
 * Covers: AIS/ADS-B normalization, invalid-coord rejection, missing fields, stale filtering,
 * dedupe by key, provider-failure fallback to replay, replay snapshot stability, exposure
 * intersection, and live/replay status labelling (never "live" on fixtures).
 */

import {
  capAssets,
  dedupeByKey,
  filterStale,
  isValidCoord,
  normalizeAdsbAircraft,
  normalizeAisPositionReport,
} from "../src/lib/live-transport/normalize";
import { LIVE_REGIONS, resolveRegion } from "../src/lib/live-transport/regions";
import {
  buildReplayVessels,
  getReplayVessels,
  loadVesselFixtures,
} from "../src/lib/live-transport/maritime/replay";
import {
  buildReplayAircraft,
  getReplayAircraft,
  loadAircraftFixtures,
} from "../src/lib/live-transport/aviation/replay";
import { getVessels } from "../src/lib/live-transport/maritime/provider";
import { getAircraft } from "../src/lib/live-transport/aviation/provider";
import { getTransportSnapshot } from "../src/lib/live-transport/service";
import { computeTransportImpact } from "../src/lib/live-transport/exposure";
import { deriveNetworkStatuses } from "../src/lib/adapters/akash";
import { loadIndustry, loadScenario, loadWorldModelById } from "../src/lib/scenarios";
import type { LiveTransportSnapshot } from "../src/lib/live-transport/types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`live-transport: ${msg}`);
}

const NOW = new Date("2026-07-17T12:00:00.000Z");
const taiwan = LIVE_REGIONS.taiwan;

export async function runLiveTransportTests() {
  console.log("\n── Live transport: normalization ──");

  // AIS PositionReport → asset
  const aisRaw = {
    MessageType: "PositionReport",
    MetaData: {
      MMSI: 416001234,
      ShipName: "FIC EXAMPLE",
      latitude: 24.2,
      longitude: 120.6,
      time_utc: "2026-07-17T11:59:30.000Z",
    },
    Message: {
      PositionReport: { Latitude: 24.2, Longitude: 120.6, Cog: 120, Sog: 12.5, TrueHeading: 118 },
    },
  };
  const ais = normalizeAisPositionReport(aisRaw, taiwan, NOW);
  assert(ais, "AIS report should normalize");
  assert(ais!.id === "mmsi-416001234", "AIS dedupe key should be MMSI");
  assert(ais!.type === "vessel" && ais!.source === "aisstream", "AIS type/source");
  assert(ais!.headingDegrees === 118, "AIS heading from TrueHeading");
  assert(ais!.speedKnots === 12.5, "AIS speed from SOG");
  assert(ais!.ageSeconds === 30, "AIS ageSeconds from time_utc");
  console.log(`  AIS ok → ${ais!.id} hdg=${ais!.headingDegrees} sog=${ais!.speedKnots} age=${ais!.ageSeconds}`);

  // AIS TrueHeading 511 (not available) → falls back to COG
  const aisFallback = normalizeAisPositionReport(
    { MetaData: { MMSI: 1, latitude: 24, longitude: 120 }, Message: { PositionReport: { Cog: 88, Sog: 3, TrueHeading: 511 } } },
    taiwan,
    NOW
  );
  assert(aisFallback && aisFallback.headingDegrees === 88, "TrueHeading 511 → COG fallback");

  // ADS-B aircraft → asset
  const adsbRaw = {
    hex: "A1B2C3",
    flight: "CFA123 ",
    lat: 24.2,
    lon: 121.0,
    alt_baro: 35000,
    gs: 460,
    track: 210,
    r: "FIC-TWN001",
    t: "B77L",
    seen_pos: 4.2,
  };
  const adsb = normalizeAdsbAircraft(adsbRaw, NOW);
  assert(adsb, "ADS-B should normalize");
  assert(adsb!.id === "hex-a1b2c3", "ADS-B id from hex (lowercased)");
  assert(adsb!.callsign === "CFA123", "ADS-B callsign trimmed");
  assert(adsb!.altitudeFeet === 35000, "ADS-B altitude from alt_baro");
  assert(adsb!.speedKnots === 460 && adsb!.headingDegrees === 210, "ADS-B gs/track");
  assert(adsb!.registration === "FIC-TWN001", "ADS-B registration from r");
  assert(adsb!.ageSeconds === 4, "ADS-B ageSeconds from seen_pos");
  console.log(`  ADS-B ok → ${adsb!.id} ${adsb!.callsign} alt=${adsb!.altitudeFeet} age=${adsb!.ageSeconds}`);

  // alt_baro "ground" → 0
  const grounded = normalizeAdsbAircraft({ hex: "abc", lat: 24, lon: 121, alt_baro: "ground" }, NOW);
  assert(grounded && grounded.altitudeFeet === 0, "alt_baro 'ground' → 0");

  console.log("── Live transport: invalid + missing ──");
  assert(!isValidCoord(91, 181), "91/181 sentinel is invalid");
  assert(!isValidCoord(0, 0), "0/0 is invalid");
  assert(!isValidCoord("x", 10), "non-number is invalid");
  assert(isValidCoord(24, 120), "valid coord accepted");
  // invalid AIS coords rejected
  assert(
    normalizeAisPositionReport({ MetaData: { MMSI: 5, latitude: 91, longitude: 181 } }, taiwan, NOW) === null,
    "AIS invalid coords → null"
  );
  // out-of-region AIS rejected
  assert(
    normalizeAisPositionReport({ MetaData: { MMSI: 6, latitude: 0.5, longitude: 100 }, Message: { PositionReport: {} } }, taiwan, NOW) === null,
    "AIS out-of-region → null"
  );
  // missing MMSI rejected
  assert(
    normalizeAisPositionReport({ MetaData: { latitude: 24, longitude: 120 }, Message: { PositionReport: {} } }, taiwan, NOW) === null,
    "AIS missing MMSI → null"
  );
  // missing hex rejected
  assert(normalizeAdsbAircraft({ lat: 24, lon: 121 }, NOW) === null, "ADS-B missing hex → null");
  // missing lat/lon rejected
  assert(normalizeAdsbAircraft({ hex: "a1", gs: 400 }, NOW) === null, "ADS-B missing coords → null");
  // ADS-B with partial fields still normalizes (nullable fields)
  const partial = normalizeAdsbAircraft({ hex: "dead01", lat: 24, lon: 121 }, NOW);
  assert(partial && partial.speedKnots === null && partial.altitudeFeet === null, "ADS-B partial fields → nulls");
  console.log("  invalid/missing handled");

  console.log("── Live transport: stale filter + dedupe + cap ──");
  const staleSet = [
    { id: "a", ageSeconds: 10 },
    { id: "b", ageSeconds: 5000 },
    { id: "c", ageSeconds: 100 },
  ];
  assert(filterStale(staleSet, 3600).length === 2, "stale asset dropped (>3600s)");
  const dupSet = [
    { id: "x", ageSeconds: 50 },
    { id: "x", ageSeconds: 10 },
    { id: "y", ageSeconds: 20 },
  ];
  const deduped = dedupeByKey(dupSet);
  assert(deduped.length === 2, "dedupe collapses by id");
  assert(deduped.find((d) => d.id === "x")!.ageSeconds === 10, "dedupe keeps freshest");
  assert(capAssets(dupSet, 1).length === 1, "capAssets bounds length");
  console.log("  stale/dedupe/cap ok");

  console.log("── Live transport: replay snapshot stability ──");
  const rawV = loadVesselFixtures(taiwan);
  assert(rawV.length >= 30, `taiwan needs >=30 vessels, got ${rawV.length}`);
  const rawA = loadAircraftFixtures(taiwan);
  assert(rawA.length >= 20, `taiwan needs >=20 aircraft, got ${rawA.length}`);
  const rawRV = loadVesselFixtures(LIVE_REGIONS.redSea);
  const rawRA = loadAircraftFixtures(LIVE_REGIONS.redSea);
  assert(rawRV.length >= 20, `red-sea needs >=20 vessels, got ${rawRV.length}`);
  assert(rawRA.length >= 12, `red-sea needs >=12 aircraft, got ${rawRA.length}`);

  const v1 = buildReplayVessels(rawV, taiwan, 600, NOW);
  const v2 = buildReplayVessels(rawV, taiwan, 600, NOW);
  assert(JSON.stringify(v1) === JSON.stringify(v2), "replay vessels deterministic (same elapsed → identical)");
  const a1 = buildReplayAircraft(rawA, taiwan, 600, NOW);
  const a2 = buildReplayAircraft(rawA, taiwan, 600, NOW);
  assert(JSON.stringify(a1) === JSON.stringify(a2), "replay aircraft deterministic");
  // different elapsed → moved positions (for at least one moving asset)
  const v3 = buildReplayVessels(rawV, taiwan, 3600, NOW);
  assert(
    v1.some((v, i) => v.latitude !== v3[i].latitude || v.longitude !== v3[i].longitude),
    "different elapsed advances positions"
  );
  // all replay positions in-bounds
  const b = taiwan.bounds;
  assert(
    [...v3, ...a1].every((x) => x.latitude >= b.south && x.latitude <= b.north && x.longitude >= b.west && x.longitude <= b.east),
    "replay positions stay in-bounds"
  );
  console.log(`  taiwan fixtures: ${rawV.length} vessels, ${rawA.length} aircraft — deterministic + in-bounds`);

  console.log("── Live transport: provider fallback + labelling ──");
  // Force replay: providers must never label mode "live".
  const vRes = await getVessels(taiwan, { replay: true });
  const aRes = await getAircraft(taiwan, { replay: true });
  assert(vRes.status.mode === "replay", "forced-replay maritime is replay mode");
  assert(aRes.status.mode === "replay", "forced-replay aviation is replay mode");
  assert(vRes.assets.every((x) => x.dataMode === "replay" && x.source === "replay"), "replay vessels labelled replay");
  assert(aRes.assets.every((x) => x.dataMode === "replay" && x.source === "replay"), "replay aircraft labelled replay");
  // With live enabled but no AIS key, maritime still falls back to replay (never throws).
  const prevEnabled = process.env.LIVE_TRANSPORT_ENABLED;
  const prevKey = process.env.AISSTREAM_API_KEY;
  process.env.LIVE_TRANSPORT_ENABLED = "true";
  delete process.env.AISSTREAM_API_KEY;
  const vNoKey = await getVessels(taiwan, {});
  assert(vNoKey.status.mode === "replay", "no AIS key → maritime replay (no throw)");
  assert(/AISSTREAM_API_KEY/.test(vNoKey.status.message ?? ""), "status explains missing key");
  process.env.LIVE_TRANSPORT_ENABLED = prevEnabled;
  if (prevKey !== undefined) process.env.AISSTREAM_API_KEY = prevKey;
  console.log(`  maritime=${vRes.status.provider}/${vRes.status.mode} aviation=${aRes.status.provider}/${aRes.status.mode}`);

  console.log("── Live transport: snapshot service (independent providers) ──");
  const snap = await getTransportSnapshot("taiwan", { replay: true });
  assert(snap.regionId === "taiwan", "snapshot region");
  assert(snap.vessels.length >= 30 && snap.aircraft.length >= 20, "snapshot has vessels + aircraft");
  assert(snap.providers.maritime.mode === "replay" && snap.providers.aviation.mode === "replay", "snapshot providers replay");
  console.log(`  snapshot ${snap.id}: ${snap.vessels.length} vessels, ${snap.aircraft.length} aircraft`);

  console.log("── Live transport: exposure intersection ──");
  const industry = loadIndustry("semiconductors");
  const world = loadWorldModelById("semiconductors");
  const primary = loadScenario("taiwan-earthquake");
  const secondary = loadScenario("japan-export-restriction");

  // Build a deterministic baseline snapshot for exposure (fixed elapsed + now).
  const baseline: LiveTransportSnapshot = {
    ...snap,
    vessels: buildReplayVessels(rawV, taiwan, 0, NOW),
    aircraft: buildReplayAircraft(rawA, taiwan, 0, NOW),
  };

  const primaryStatuses = deriveNetworkStatuses(primary, world);
  const e1 = computeTransportImpact(baseline, primary, primaryStatuses, industry);
  assert(e1.impact.observedVesselsInRegion === baseline.vessels.length, "observed vessels count");
  assert(e1.impact.exposedVesselCount > 0, "primary: some vessels exposed near Taiwan nodes");
  assert(e1.impact.exposedAircraftCount > 0, "primary: some aircraft exposed near Taiwan nodes");
  assert(e1.impact.exposedVesselCount < e1.impact.observedVesselsInRegion, "not ALL vessels exposed (intersection is selective)");
  assert(e1.impact.medianReroutingDelayDays != null, "primary delay computed");
  assert(e1.impact.methodology.length >= 5, "methodology explains heuristic");
  // deterministic
  const e1b = computeTransportImpact(baseline, primary, primaryStatuses, industry);
  assert(JSON.stringify(e1) === JSON.stringify(e1b), "exposure deterministic (same inputs → identical)");

  // Merged (primary + secondary Japan) scenario for the escalation comparison.
  const merged = { ...primary, shocks: [...primary.shocks, ...secondary.shocks] };
  const mergedStatuses = deriveNetworkStatuses(merged, world);
  const s2 = computeTransportImpact(baseline, merged, mergedStatuses, industry);
  assert(
    s2.impact.exposedAircraftCount >= e1.impact.exposedAircraftCount,
    "secondary (Japan) shock exposes >= aircraft than primary"
  );
  assert(s2.impact.exposedAircraftCount > e1.impact.exposedAircraftCount, "secondary adds Japan-facing aircraft");
  assert(s2.impact.confidence < e1.impact.confidence, "secondary lowers confidence");
  assert(
    (s2.impact.medianReroutingDelayDays ?? 0) > (e1.impact.medianReroutingDelayDays ?? 0),
    "secondary widens rerouting delay"
  );
  console.log(
    `  primary: ${e1.impact.exposedVesselCount} vessels / ${e1.impact.exposedAircraftCount} aircraft exposed · delay ${e1.impact.medianReroutingDelayDays}d · conf ${e1.impact.confidence}`
  );
  console.log(
    `  +japan : ${s2.impact.exposedVesselCount} vessels / ${s2.impact.exposedAircraftCount} aircraft exposed · delay ${s2.impact.medianReroutingDelayDays}d · conf ${s2.impact.confidence}`
  );
  const teu = e1.impact.estimatedMaritimeCapacityExposure;
  const air = s2.impact.estimatedAirCapacityReductionPercent;
  console.log(
    `  maritime TEU-equivalent exposed ~${teu ? `${teu.min.toLocaleString()}–${teu.max.toLocaleString()}` : "n/a"} · air-freight −${air ? `${air.min}–${air.max}%` : "n/a"} (+japan)`
  );

  console.log("\n✓ Live-transport assertions passed");
  return { primary: e1.impact, secondary: s2.impact };
}

// Allow standalone execution.
if (import.meta.url === `file://${process.argv[1]}`) {
  runLiveTransportTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
