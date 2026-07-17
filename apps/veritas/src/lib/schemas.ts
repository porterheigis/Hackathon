/**
 * Zod schemas at every boundary: Gamma API responses, RSS items, risk
 * decisions, and agent tool inputs. Nothing untyped crosses into the loop.
 */
import { z } from "zod";

/** Gamma encodes arrays as JSON strings: outcomePrices: "[\"0.03\", \"0.97\"]" */
const jsonNumberArray = z.string().transform((s, ctx) => {
  try {
    return z.array(z.coerce.number()).parse(JSON.parse(s));
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "bad JSON number array" });
    return z.NEVER;
  }
});

const jsonStringArray = z.string().transform((s, ctx) => {
  try {
    return z.array(z.string()).parse(JSON.parse(s));
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "bad JSON string array" });
    return z.NEVER;
  }
});

export const GammaMarketSchema = z.object({
  id: z.string(),
  question: z.string(),
  slug: z.string().optional().default(""),
  outcomes: jsonStringArray,
  outcomePrices: jsonNumberArray,
  volume24hr: z.coerce.number().optional().default(0),
  liquidityNum: z.coerce.number().optional().default(0),
  endDate: z.string().optional(),
  active: z.boolean().optional().default(false),
  closed: z.boolean().optional().default(true),
});
export type GammaMarket = z.infer<typeof GammaMarketSchema>;

export interface Market {
  id: string;
  question: string;
  slug: string;
  yesPrice: number;
  noPrice: number;
  volume24h: number;
  liquidity: number;
  endDate: string;
  active: boolean;
  closed: boolean;
}

/**
 * Normalize a Gamma market. Returns null when it is not a binary Yes/No
 * market. With `requireTradable` (default), also drops inactive/closed/expired
 * markets and degenerate prices.
 */
export function toMarket(
  raw: GammaMarket,
  opts: { requireTradable?: boolean } = {}
): Market | null {
  const requireTradable = opts.requireTradable ?? true;
  if (raw.outcomes.length !== 2) return null;
  if (raw.outcomes[0].toLowerCase() !== "yes" || raw.outcomes[1].toLowerCase() !== "no") {
    return null;
  }
  if (raw.outcomePrices.length !== 2) return null;
  const [yesPrice, noPrice] = raw.outcomePrices;
  const market: Market = {
    id: raw.id,
    question: raw.question,
    slug: raw.slug,
    yesPrice,
    noPrice,
    volume24h: raw.volume24hr,
    liquidity: raw.liquidityNum,
    endDate: raw.endDate ?? "",
    active: raw.active,
    closed: raw.closed,
  };
  if (requireTradable) {
    if (!raw.active || raw.closed) return null;
    if (!raw.endDate || new Date(raw.endDate).getTime() <= Date.now()) return null;
    if (!(yesPrice > 0 && yesPrice < 1)) return null;
  }
  return market;
}

export const RssItemSchema = z.object({
  title: z.string().min(1),
  url: z.string(),
  published: z.string(),
});
export type NewsItem = z.infer<typeof RssItemSchema>;

export const RiskDecisionSchema = z.object({
  decision: z.enum(["ALLOW", "DENY"]),
  reason: z.string(),
  max_stake_usd: z.number(),
  attempted_usd: z.number(),
  source: z.enum(["pomerium-live", "policy-mirror"]),
});
export type RiskDecision = z.infer<typeof RiskDecisionSchema>;

export const PolicySchema = z.object({
  risk_officer: z.object({
    execute_trade: z.object({
      max_stake_usd: z.number().positive(),
      max_trades_per_run: z.number().int().positive().default(1),
    }),
  }),
});
export type Policy = z.infer<typeof PolicySchema>;

/* Agent tool inputs — the API guarantees shape via strict tool use; these
 * re-validate at execution so a bug can never place a malformed order. */
export const FetchNewsInput = z.object({ topic: z.string() });
export const SearchMarketsInput = z.object({ query: z.string().min(1) });
export const GetMarketInput = z.object({ market_id: z.string().min(1) });
export const ExecuteTradeInput = z.object({
  market_id: z.string().min(1),
  side: z.enum(["YES", "NO"]),
  size_usd: z.number().positive(),
  thesis: z.string().min(1),
});
export const GetPortfolioInput = z.object({});

export const NexlaRpcResponseSchema = z.object({
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
