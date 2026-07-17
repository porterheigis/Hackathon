/**
 * Polymarket Gamma API — real prediction markets, real prices, no keys.
 * Paper fills only: we read prices, we never place on-chain orders.
 *
 * Known quirks (verified live):
 * - `outcomePrices` / `outcomes` are JSON-encoded strings → zod transform.
 * - /public-search returns closed and ancient markets → hard filter.
 */
import { fetchWithCache } from "../cache";
import { GammaMarketSchema, toMarket, type Market } from "../schemas";
import type { Emit } from "../sse";

const GAMMA = "https://gamma-api.polymarket.com";

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": "veritas-desk/0.1" },
  });
  if (!res.ok) throw new Error(`gamma ${res.status} on ${new URL(url).pathname}`);
  return res.json();
}

function parseMarketList(raw: unknown, requireTradable = true): Market[] {
  if (!Array.isArray(raw)) return [];
  const out: Market[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const parsed = GammaMarketSchema.safeParse(item);
    if (!parsed.success) continue;
    const market = toMarket(parsed.data, { requireTradable });
    if (market && !seen.has(market.id)) {
      seen.add(market.id);
      out.push(market);
    }
  }
  return out.sort((a, b) => b.volume24h - a.volume24h);
}

export interface MarketsResult {
  markets: Market[];
  fetched_at: string;
  note?: string;
}

/** Top binary markets by 24h volume — the board's resting state. */
export async function topMarkets(opts: {
  emit?: Emit;
  limit?: number;
} = {}): Promise<MarketsResult> {
  const { data, fetchedAt, note } = await fetchWithCache<Market[]>({
    source: "polymarket",
    key: "pm:top",
    emit: opts.emit,
    fn: async () => {
      const raw = await getJson(
        `${GAMMA}/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=50`
      );
      const markets = parseMarketList(raw);
      if (markets.length === 0) throw new Error("gamma returned 0 tradable markets");
      return markets;
    },
  });
  return { markets: data.slice(0, opts.limit ?? 10), fetched_at: fetchedAt, note };
}

/**
 * Search via /public-search (events with nested markets), falling back to a
 * keyword filter over the top-volume list. An empty result is a valid answer
 * (the agent pivots), not an error.
 */
export async function searchMarkets(
  query: string,
  opts: { emit?: Emit; limit?: number } = {}
): Promise<MarketsResult> {
  const { data, fetchedAt, note } = await fetchWithCache<Market[]>({
    source: "polymarket",
    key: `pm:search:${query.toLowerCase()}`,
    emit: opts.emit,
    fn: async () => {
      const raw = await getJson(
        `${GAMMA}/public-search?q=${encodeURIComponent(query)}&limit_per_type=10`
      );
      const nested: unknown[] = [];
      if (raw && typeof raw === "object" && Array.isArray((raw as { events?: unknown[] }).events)) {
        for (const event of (raw as { events: unknown[] }).events) {
          const markets = (event as { markets?: unknown[] }).markets;
          if (Array.isArray(markets)) nested.push(...markets);
        }
      }
      let markets = parseMarketList(nested);
      if (markets.length === 0) {
        // Fallback: keyword match over the live top-volume list.
        const top = await getJson(
          `${GAMMA}/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=100`
        );
        const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
        markets = parseMarketList(top).filter((m) =>
          tokens.some((t) => m.question.toLowerCase().includes(t))
        );
      }
      return markets;
    },
  });
  return { markets: data.slice(0, opts.limit ?? 8), fetched_at: fetchedAt, note };
}

export interface MarketResult {
  market: Market;
  fetched_at: string;
  note?: string;
}

/** Fresh quote for one market — called before sizing and before every fill. */
export async function getMarket(
  marketId: string,
  opts: { emit?: Emit } = {}
): Promise<MarketResult> {
  const { data, fetchedAt, note } = await fetchWithCache<Market>({
    source: "polymarket",
    key: `pm:market:${marketId}`,
    emit: opts.emit,
    fn: async () => {
      const raw = await getJson(`${GAMMA}/markets/${encodeURIComponent(marketId)}`);
      const parsed = GammaMarketSchema.parse(raw);
      const market = toMarket(parsed, { requireTradable: false });
      if (!market) throw new Error(`market ${marketId} is not a binary Yes/No market`);
      return market;
    },
  });
  return { market: data, fetched_at: fetchedAt, note };
}
