/**
 * Zero.xyz adapter — prediction-market odds, news, and execution.
 * No direct Polymarket/Kalshi API keys. Live path uses ZERO_* env;
 * demo/replay records capability discovery + wallet/spend telemetry.
 */

import { loadFixtureEvent } from "../store";
import type { FixtureEvent } from "../types";

export interface ZeroCapability {
  id: string;
  name: string;
  category: string;
  pricePerCallUsd: number;
}

export interface ZeroOddsResult {
  event: FixtureEvent;
  capabilities: ZeroCapability[];
  spendUsd: number;
  source: "zero-live" | "zero-fixture";
}

export interface ZeroFillResult {
  tx: string;
  market_id: string;
  side: string;
  size_usd: number;
  price: number;
  spendUsd: number;
  walletAfter: number;
  source: "zero-live" | "zero-fixture";
}

let walletUsd = Number(process.env.ZERO_WALLET_USD ?? "5.00");
let totalSpend = 0;
const discovered: ZeroCapability[] = [];

export function getZeroWallet(): { balance: number; spend: number } {
  return { balance: walletUsd, spend: totalSpend };
}

export function getDiscoveredCapabilities(): ZeroCapability[] {
  return [...discovered];
}

export function resetZeroWallet(start = 5): void {
  walletUsd = start;
  totalSpend = 0;
  discovered.length = 0;
}

const FIXTURE_CAPABILITIES: ZeroCapability[] = [
  {
    id: "svc-polymarket-odds-v1",
    name: "polymarket-odds-v1",
    category: "prediction-markets",
    pricePerCallUsd: 0.02,
  },
  {
    id: "svc-kalshi-odds-v1",
    name: "kalshi-odds-v1",
    category: "prediction-markets",
    pricePerCallUsd: 0.02,
  },
  {
    id: "svc-news-search-v1",
    name: "breaking-news-search",
    category: "news",
    pricePerCallUsd: 0.01,
  },
  {
    id: "svc-pm-execution-v1",
    name: "prediction-market-execution",
    category: "prediction-markets",
    pricePerCallUsd: 0.05,
  },
];

function hasLiveZero(): boolean {
  return Boolean(process.env.ZERO_API_URL || process.env.ZERO_WALLET_KEY);
}

async function zeroFetch(
  path: string,
  body?: Record<string, unknown>
): Promise<unknown | null> {
  const base = process.env.ZERO_API_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ZERO_WALLET_KEY ?? ""}`,
      },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function charge(amount: number): void {
  totalSpend += amount;
  walletUsd = Math.max(0, walletUsd - amount);
}

function discover(cap: ZeroCapability): void {
  if (!discovered.find((c) => c.id === cap.id)) {
    discovered.push(cap);
  }
}

/** Discover + pay for odds + news; select candidate event */
export async function ingestViaZero(opts?: {
  replay?: boolean;
}): Promise<ZeroOddsResult> {
  if (!opts?.replay && hasLiveZero()) {
    const live = await zeroFetch("/v1/prediction-markets/scan", {
      watchlist: ["red-sea", "brent", "freight"],
    });
    if (live) {
      const caps = FIXTURE_CAPABILITIES.slice(0, 3);
      caps.forEach(discover);
      const spend = caps.reduce((s, c) => s + c.pricePerCallUsd, 0);
      charge(spend);
      return {
        event: live as FixtureEvent,
        capabilities: caps,
        spendUsd: spend,
        source: "zero-live",
      };
    }
  }

  // Fixture / replay path — still records capability discovery + spend
  const caps = FIXTURE_CAPABILITIES.slice(0, 3);
  caps.forEach(discover);
  const spend = caps.reduce((s, c) => s + c.pricePerCallUsd, 0);
  charge(spend);

  return {
    event: loadFixtureEvent(),
    capabilities: caps,
    spendUsd: spend,
    source: "zero-fixture",
  };
}

/** Place micro-stake via Zero execution service (or signed fixture fill) */
export async function executeViaZero(args: {
  market_id: string;
  side: string;
  size_usd: number;
  price: number;
}): Promise<ZeroFillResult> {
  const execCap = FIXTURE_CAPABILITIES.find(
    (c) => c.id === "svc-pm-execution-v1"
  )!;
  discover(execCap);

  if (hasLiveZero()) {
    const live = await zeroFetch("/v1/prediction-markets/execute", args);
    if (live) {
      const fee = execCap.pricePerCallUsd;
      charge(args.size_usd + fee);
      const result = live as {
        tx: string;
        walletAfter?: number;
      };
      return {
        tx: result.tx,
        market_id: args.market_id,
        side: args.side,
        size_usd: args.size_usd,
        price: args.price,
        spendUsd: args.size_usd + fee,
        walletAfter: result.walletAfter ?? walletUsd,
        source: "zero-live",
      };
    }
  }

  const fee = execCap.pricePerCallUsd;
  charge(args.size_usd + fee);
  const tx = `zero-fixture-tx-${Date.now().toString(36)}`;

  return {
    tx,
    market_id: args.market_id,
    side: args.side,
    size_usd: args.size_usd,
    price: args.price,
    spendUsd: args.size_usd + fee,
    walletAfter: walletUsd,
    source: "zero-fixture",
  };
}
