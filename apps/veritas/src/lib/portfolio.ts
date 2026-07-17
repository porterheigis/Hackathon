/**
 * Paper wallet + position book. `markToMarket` is the ONLY P&L formula in
 * the codebase (server computes, UI renders) — marks against real Gamma
 * quotes, not an invented multiplier.
 */
import { nowIso, uid } from "./sse";

export interface Position {
  id: string;
  marketId: string;
  question: string;
  side: "YES" | "NO";
  sizeUsd: number;
  entryPrice: number;
  currentPrice: number;
  ts: string;
  thesis: string;
}

export interface DeniedOrder {
  id: string;
  marketId: string;
  question: string;
  side: "YES" | "NO";
  sizeUsd: number;
  reason: string;
  source: string;
  ts: string;
}

export interface PortfolioSnapshot {
  walletUsd: number;
  startingUsd: number;
  markPnl: number;
  positions: Position[];
  denials: DeniedOrder[];
}

const startingUsd = Number(process.env.WALLET_USD ?? "100");
let walletUsd = startingUsd;
const positions: Position[] = [];
const denials: DeniedOrder[] = [];

/**
 * P&L of a stake bought at entryPrice now quoted at currentPrice:
 * shares = size/entry, value = shares * current → pnl = size * (current/entry - 1).
 */
export function markToMarket(
  sizeUsd: number,
  entryPrice: number,
  currentPrice: number
): number {
  if (entryPrice <= 0) return 0;
  return sizeUsd * (currentPrice / entryPrice - 1);
}

export function recordFill(args: {
  marketId: string;
  question: string;
  side: "YES" | "NO";
  sizeUsd: number;
  price: number;
  thesis: string;
}): Position {
  const position: Position = {
    id: uid("pos"),
    marketId: args.marketId,
    question: args.question,
    side: args.side,
    sizeUsd: args.sizeUsd,
    entryPrice: args.price,
    currentPrice: args.price,
    ts: nowIso(),
    thesis: args.thesis,
  };
  walletUsd = Math.round((walletUsd - args.sizeUsd) * 100) / 100;
  positions.push(position);
  return position;
}

export function recordDenial(args: {
  marketId: string;
  question: string;
  side: "YES" | "NO";
  sizeUsd: number;
  reason: string;
  source: string;
}): DeniedOrder {
  const denial: DeniedOrder = { id: uid("deny"), ts: nowIso(), ...args };
  denials.push(denial);
  return denial;
}

/** Update marks for every position held on a market (yes/no quote pair). */
export function updateMarks(marketId: string, yesPrice: number, noPrice: number): void {
  for (const position of positions) {
    if (position.marketId !== marketId) continue;
    position.currentPrice = position.side === "YES" ? yesPrice : noPrice;
  }
}

export function heldMarketIds(): string[] {
  return [...new Set(positions.map((p) => p.marketId))];
}

export function snapshot(): PortfolioSnapshot {
  const markPnl = positions.reduce(
    (sum, p) => sum + markToMarket(p.sizeUsd, p.entryPrice, p.currentPrice),
    0
  );
  return {
    walletUsd,
    startingUsd,
    markPnl: Math.round(markPnl * 100) / 100,
    positions: [...positions],
    denials: [...denials],
  };
}
