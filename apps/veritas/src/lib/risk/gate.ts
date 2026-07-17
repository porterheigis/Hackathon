/**
 * Risk gate for execute_trade.
 *
 * Live path: Pomerium MCP route (403 = DENY, 200 = ALLOW), enabled by
 * POMERIUM_MCP_URL. Mirror path: parses policy/risk.yaml AT RUNTIME — the
 * yaml is the single source of truth, there is no hardcoded cap. A live
 * failure is never silent: the status chip flips and the tape announces the
 * fallback to the mirror.
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { setStatus } from "../cache";
import { PolicySchema, RiskDecisionSchema, type Policy, type RiskDecision } from "../schemas";
import type { Emit } from "../sse";
import { nowIso, uid } from "../sse";

const POLICY_PATH = path.join(process.cwd(), "policy", "risk.yaml");

/** Re-read on every call so a live edit of risk.yaml applies to the next order. */
export function loadPolicy(): Policy {
  const raw = fs.readFileSync(POLICY_PATH, "utf8");
  return PolicySchema.parse(YAML.parse(raw));
}

function mirrorDecision(sizeUsd: number, policy: Policy): RiskDecision {
  const max = policy.risk_officer.execute_trade.max_stake_usd;
  return RiskDecisionSchema.parse({
    decision: sizeUsd > max ? "DENY" : "ALLOW",
    reason: sizeUsd > max ? "max_stake_exceeded" : "within_stake_limit",
    max_stake_usd: max,
    attempted_usd: sizeUsd,
    source: "policy-mirror",
  });
}

export async function gateExecuteTrade(
  args: { market_id: string; side: string; size_usd: number },
  emit?: Emit
): Promise<RiskDecision> {
  const policy = loadPolicy();
  const max = policy.risk_officer.execute_trade.max_stake_usd;
  const url = process.env.POMERIUM_MCP_URL;

  if (url) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.POMERIUM_SERVICE_TOKEN ?? ""}`,
        },
        body: JSON.stringify({ tool: "execute_trade", arguments: args }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 403) {
        setStatus("pomerium", "live", "risk gate enforced", emit);
        const body = await res.text();
        return RiskDecisionSchema.parse({
          decision: "DENY",
          reason: body.trim() || "pomerium_policy_denied",
          max_stake_usd: max,
          attempted_usd: args.size_usd,
          source: "pomerium-live",
        });
      }
      if (res.ok) {
        setStatus("pomerium", "live", "risk gate enforced", emit);
        return RiskDecisionSchema.parse({
          decision: "ALLOW",
          reason: "policy_ok",
          max_stake_usd: max,
          attempted_usd: args.size_usd,
          source: "pomerium-live",
        });
      }
      throw new Error(`pomerium ${res.status}`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setStatus("pomerium", "down", detail, emit);
      emit?.({
        type: "tape",
        id: uid("gate"),
        ts: nowIso(),
        kind: "system",
        text: `pomerium unreachable (${detail}) — enforcing policy mirror from policy/risk.yaml`,
      });
      return mirrorDecision(args.size_usd, policy);
    }
  }

  setStatus("pomerium", "mirror", "policy mirror (policy/risk.yaml)", emit);
  return mirrorDecision(args.size_usd, policy);
}
