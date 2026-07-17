/**
 * The five tools the agent can call — served to Claude Code as MCP tools
 * (mcp__veritas__*) by scripts/veritas-mcp.ts, executed here server-side,
 * inputs re-validated with zod.
 *
 * The anti-atlas core lives in execute_trade: a DENY comes back as an
 * is_error tool result carrying the reason and the cap — the resized order
 * on the next turn is a genuine model decision, there is no hardcoded
 * correction anywhere.
 */
import { logSignal, recordFill as nexlaRecordFill } from "../adapters/nexla";
import { gateExecuteTrade } from "../risk/gate";
import {
  ExecuteTradeInput,
  FetchNewsInput,
  GetMarketInput,
  GetPortfolioInput,
  SearchMarketsInput,
  type Market,
} from "../schemas";
import { fetchNews } from "../sources/news";
import { getMarket, searchMarkets } from "../sources/polymarket";
import {
  heldMarketIds,
  recordDenial,
  recordFill,
  snapshot,
  updateMarks,
} from "../portfolio";
import type { Emit } from "../sse";

export interface ToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "fetch_news",
    description:
      "Read the live news wire. Pass topic:\"\" for the general world wire (BBC), or a specific topic (e.g. \"opec oil supply\") for targeted headlines (Google News). Returns real, timestamped headlines.",
    input_schema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Search topic. Empty string = general world wire.",
        },
      },
      required: ["topic"],
      additionalProperties: false,
    },
  },
  {
    name: "search_markets",
    description:
      "Search live Polymarket prediction markets by keyword. Returns open binary Yes/No markets with real current prices, 24h volume, liquidity and end date. An empty list means no tradable market matches — pivot to another story or query.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword query, e.g. \"ceasefire\"." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_market",
    description:
      "Pull a fresh quote for one market by id. Always call this before sizing an order — prices move.",
    input_schema: {
      type: "object",
      properties: {
        market_id: { type: "string", description: "Market id from search_markets." },
      },
      required: ["market_id"],
      additionalProperties: false,
    },
  },
  {
    name: "execute_trade",
    description:
      "Place a paper order at the current real price. Every order passes a risk gate; a rejection returns the reason and the policy limits — adjust and retry.",
    input_schema: {
      type: "object",
      properties: {
        market_id: { type: "string", description: "Market id to trade." },
        side: { type: "string", enum: ["YES", "NO"], description: "Outcome to buy." },
        size_usd: { type: "number", description: "Stake in USD." },
        thesis: {
          type: "string",
          description: "One-sentence thesis citing the headline(s) driving the trade.",
        },
      },
      required: ["market_id", "side", "size_usd", "thesis"],
      additionalProperties: false,
    },
  },
  {
    name: "get_portfolio",
    description:
      "Current wallet, open positions and mark-to-market P&L at fresh prices.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
];

export interface RunState {
  trades: number;
  denials: number;
}

export interface ToolOutcome {
  ok: boolean;
  deny?: boolean;
  result: unknown;
}

function compactMarket(m: Market) {
  return {
    market_id: m.id,
    question: m.question,
    yes_price: m.yesPrice,
    no_price: m.noPrice,
    volume_24h: Math.round(m.volume24h),
    liquidity: Math.round(m.liquidity),
    end_date: m.endDate,
  };
}

export async function executeTool(
  name: string,
  input: unknown,
  ctx: { emit: Emit; run: RunState }
): Promise<ToolOutcome> {
  const { emit, run } = ctx;
  try {
    switch (name) {
      case "fetch_news": {
        const { topic } = FetchNewsInput.parse(input);
        const news = await fetchNews({ topic: topic || undefined, emit });
        return {
          ok: true,
          result: {
            source: news.source,
            fetched_at: news.fetched_at,
            ...(news.note ? { note: news.note } : {}),
            headlines: news.items.map((i) => ({
              title: i.title,
              published: i.published,
            })),
          },
        };
      }

      case "search_markets": {
        const { query } = SearchMarketsInput.parse(input);
        const found = await searchMarkets(query, { emit });
        return {
          ok: true,
          result: {
            query,
            fetched_at: found.fetched_at,
            ...(found.note ? { note: found.note } : {}),
            markets: found.markets.map(compactMarket),
          },
        };
      }

      case "get_market": {
        const { market_id } = GetMarketInput.parse(input);
        const quote = await getMarket(market_id, { emit });
        updateMarks(market_id, quote.market.yesPrice, quote.market.noPrice);
        return {
          ok: true,
          result: {
            fetched_at: quote.fetched_at,
            ...(quote.note ? { note: quote.note } : {}),
            ...compactMarket(quote.market),
            active: quote.market.active,
            closed: quote.market.closed,
          },
        };
      }

      case "execute_trade": {
        const order = ExecuteTradeInput.parse(input);
        if (run.trades >= 1) {
          return {
            ok: false,
            result: {
              error: "one_trade_per_run",
              detail: "A trade was already filled this run. Close out with get_portfolio.",
            },
          };
        }

        const decision = await gateExecuteTrade(
          { market_id: order.market_id, side: order.side, size_usd: order.size_usd },
          emit
        );

        if (decision.decision === "DENY") {
          run.denials += 1;
          const quote = await getMarket(order.market_id, { emit }).catch(() => null);
          recordDenial({
            marketId: order.market_id,
            question: quote?.market.question ?? order.market_id,
            side: order.side,
            sizeUsd: order.size_usd,
            reason: decision.reason,
            source: decision.source,
          });
          logSignal(
            { market_id: order.market_id, side: order.side, thesis: order.thesis },
            emit
          );
          return {
            ok: false,
            deny: true,
            result: {
              decision: "DENY",
              reason: decision.reason,
              max_stake_usd: decision.max_stake_usd,
              attempted_usd: decision.attempted_usd,
              gate: decision.source,
              note: "Order rejected by the risk gate. Adjust the order to comply with the policy and retry.",
            },
          };
        }

        const quote = await getMarket(order.market_id, { emit });
        if (!quote.market.active || quote.market.closed) {
          return {
            ok: false,
            result: { error: "market_not_tradable", detail: "Market is closed or inactive." },
          };
        }
        const price = order.side === "YES" ? quote.market.yesPrice : quote.market.noPrice;
        if (!(price > 0 && price < 1)) {
          return {
            ok: false,
            result: { error: "degenerate_price", detail: `Quote for ${order.side} is ${price}.` },
          };
        }
        const wallet = snapshot().walletUsd;
        if (order.size_usd > wallet) {
          return {
            ok: false,
            result: { error: "insufficient_wallet", wallet_usd: wallet },
          };
        }

        const position = recordFill({
          marketId: order.market_id,
          question: quote.market.question,
          side: order.side,
          sizeUsd: order.size_usd,
          price,
          thesis: order.thesis,
        });
        run.trades += 1;
        nexlaRecordFill(
          {
            market_id: order.market_id,
            side: order.side,
            size_usd: order.size_usd,
            price,
          },
          emit
        );
        emit({ type: "state", portfolio: snapshot() });
        return {
          ok: true,
          result: {
            decision: "ALLOW",
            gate: decision.source,
            fill: {
              market_id: position.marketId,
              question: position.question,
              side: position.side,
              size_usd: position.sizeUsd,
              price: position.entryPrice,
              ts: position.ts,
            },
            wallet_usd: snapshot().walletUsd,
          },
        };
      }

      case "get_portfolio": {
        GetPortfolioInput.parse(input);
        for (const marketId of heldMarketIds()) {
          const quote = await getMarket(marketId, { emit }).catch(() => null);
          if (quote) updateMarks(marketId, quote.market.yesPrice, quote.market.noPrice);
        }
        const book = snapshot();
        emit({ type: "state", portfolio: book });
        return {
          ok: true,
          result: {
            wallet_usd: book.walletUsd,
            mark_pnl_usd: book.markPnl,
            positions: book.positions.map((p) => ({
              market_id: p.marketId,
              question: p.question,
              side: p.side,
              size_usd: p.sizeUsd,
              entry_price: p.entryPrice,
              current_price: p.currentPrice,
            })),
            denied_orders: book.denials.length,
          },
        };
      }

      default:
        return { ok: false, result: { error: "unknown_tool", tool: name } };
    }
  } catch (err) {
    return {
      ok: false,
      result: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}
