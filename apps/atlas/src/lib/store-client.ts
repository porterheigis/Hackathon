import type { FundState } from "./types";

/** Client-safe idle fund state (no Node fs imports). */
export function emptyFundState(mode: "live" | "replay" = "live"): FundState {
  return {
    stage: "IDLE",
    clearance: "TRADER",
    event: null,
    scenario: null,
    affectedOutcomes: [],
    selectedOutcomes: [],
    proposals: [],
    affectedNodes: [],
    affectedEdges: [],
    disruptedEdges: [],
    sim: null,
    positions: [],
    selectedMarket: null,
    attemptedSize: null,
    approvedSize: null,
    lastDenial: null,
    telemetry: {
      zeroSpendUsd: 0,
      zeroWalletUsd: 5,
      nexlaToolCalls: 0,
      pomeriumAllow: 0,
      pomeriumDeny: 0,
      akashLeaseId: "—",
      akashProvider: "—",
      akashEndpoint: "—",
      capabilitiesDiscovered: [],
    },
    tape: [],
    mode,
    viewport: "globe",
  };
}
