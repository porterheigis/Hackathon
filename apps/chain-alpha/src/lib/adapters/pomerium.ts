/**
 * Pomerium risk gate adapter.
 * Mirrors pomerium/config.yaml mcp_tool policies locally when Pomerium is not running.
 * MAX stake: $2.00 — oversized execute_trade is DENIED; resized trade is ALLOWED.
 */

import { appendPosition, nowIso, uid } from "../store";
import type { PositionEntry } from "../types";

export const MAX_STAKE_USD = Number(process.env.POMERIUM_MAX_STAKE ?? "2.0");

export interface RiskDecision {
  allowed: boolean;
  decision: "ALLOW" | "DENY";
  reason: string;
  identity: "trader-agent" | "risk-approved";
  tool: string;
  size_usd: number;
  max_stake: number;
  source: "pomerium-live" | "pomerium-local";
  logLine: string;
}

const auditLog: RiskDecision[] = [];

export function getRiskAuditLog(): RiskDecision[] {
  return [...auditLog];
}

export function clearRiskAuditLog(): void {
  auditLog.length = 0;
}

async function callLivePomerium(
  tool: string,
  args: Record<string, unknown>
): Promise<RiskDecision | null> {
  const url = process.env.POMERIUM_MCP_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.POMERIUM_SERVICE_TOKEN ?? ""}`,
      },
      body: JSON.stringify({ tool, arguments: args }),
    });
    // 403 = deny, 200 = allow
    if (res.status === 403) {
      const body = await res.text();
      return {
        allowed: false,
        decision: "DENY",
        reason: body || "pomerium_policy_denied",
        identity: "trader-agent",
        tool,
        size_usd: Number(args.size_usd ?? 0),
        max_stake: MAX_STAKE_USD,
        source: "pomerium-live",
        logLine: `[POMERIUM LIVE] DENY ${tool} size=${args.size_usd}`,
      };
    }
    if (res.ok) {
      return {
        allowed: true,
        decision: "ALLOW",
        reason: "policy_ok",
        identity: "risk-approved",
        tool,
        size_usd: Number(args.size_usd ?? 0),
        max_stake: MAX_STAKE_USD,
        source: "pomerium-live",
        logLine: `[POMERIUM LIVE] ALLOW ${tool} size=${args.size_usd}`,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Gate execute_trade. Oversized stakes denied; within-limit approved.
 */
export async function gateExecuteTrade(args: {
  market_id: string;
  side: string;
  size_usd: number;
  price: number;
}): Promise<{ decision: RiskDecision; entry?: PositionEntry }> {
  const live = await callLivePomerium("execute_trade", args);
  if (live) {
    auditLog.push(live);
    console.log(live.logLine);
    if (!live.allowed) {
      const entry = appendPosition({
        id: uid("denial"),
        ts: nowIso(),
        kind: "denial",
        market_id: args.market_id,
        side: args.side,
        size_usd: args.size_usd,
        price: args.price,
        status: "denied",
        audit: {
          pomerium_decision: "DENY",
          nexla_tool: "execute_trade",
        },
      });
      return { decision: live, entry };
    }
    return { decision: live };
  }

  // Local policy mirror of pomerium/config.yaml
  const oversized = args.size_usd > MAX_STAKE_USD;
  const decision: RiskDecision = oversized
    ? {
        allowed: false,
        decision: "DENY",
        reason: "max_stake_exceeded",
        identity: "trader-agent",
        tool: "execute_trade",
        size_usd: args.size_usd,
        max_stake: MAX_STAKE_USD,
        source: "pomerium-local",
        logLine: `[POMERIUM] DENY execute_trade size_usd=${args.size_usd.toFixed(2)} > max=${MAX_STAKE_USD.toFixed(2)} reason=max_stake_exceeded`,
      }
    : {
        allowed: true,
        decision: "ALLOW",
        reason: "within_stake_limit",
        identity: "risk-approved",
        tool: "execute_trade",
        size_usd: args.size_usd,
        max_stake: MAX_STAKE_USD,
        source: "pomerium-local",
        logLine: `[POMERIUM] ALLOW execute_trade size_usd=${args.size_usd.toFixed(2)} <= max=${MAX_STAKE_USD.toFixed(2)} identity=risk-approved`,
      };

  auditLog.push(decision);
  console.log(decision.logLine);

  if (!decision.allowed) {
    const entry = appendPosition({
      id: uid("denial"),
      ts: nowIso(),
      kind: "denial",
      market_id: args.market_id,
      side: args.side,
      size_usd: args.size_usd,
      price: args.price,
      status: "denied",
      audit: {
        pomerium_decision: "DENY",
        nexla_tool: "execute_trade",
      },
    });
    return { decision, entry };
  }

  return { decision };
}

/** Non-trade tools always allowed for trader-agent */
export function gateReadTool(tool: string): RiskDecision {
  const decision: RiskDecision = {
    allowed: true,
    decision: "ALLOW",
    reason: "trader_agent_read",
    identity: "trader-agent",
    tool,
    size_usd: 0,
    max_stake: MAX_STAKE_USD,
    source: "pomerium-local",
    logLine: `[POMERIUM] ALLOW ${tool} identity=trader-agent`,
  };
  auditLog.push(decision);
  return decision;
}
