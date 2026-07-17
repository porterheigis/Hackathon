# VERITAS DESK

**The agent-run trading desk — for real this time.**

Same concept as ATLAS CAPITAL, with the script removed. A Claude agent reads
**today's real news wire**, picks **real Polymarket markets at live prices**,
sizes a position by conviction, gets **rejected by a live risk gate**, reads
the rejection, resizes **by its own decision**, and paper-fills at the real
quote. Every run is different. Nothing is choreographed.

## Run it

```bash
cd apps/veritas
npm install
cp .env.example .env.local   # set ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3001
```

Hit **RUN AGENT**. The center tape streams the model's summarized reasoning
live; the left column is the real BBC wire; the right column is the live
Polymarket board and the mark-to-market position book.

## What's real vs what's paper

| Real | Paper |
|---|---|
| Headlines (BBC / Google News RSS, timestamped) | Fills (no on-chain orders) |
| Market prices, volume, liquidity (Polymarket Gamma) | The $100 bankroll |
| The agent's decisions, sizing, and deny-correction | |
| The risk policy (`policy/risk.yaml`, parsed at runtime) | |

## Honesty contract

- **No fixtures.** `grep -ri fixture src/` returns nothing.
- A failed live source serves its **last real response, labeled CACHED** with
  a timestamp — in the UI chip *and* in the tool result the agent reads.
  A source that never answered is **DOWN**, and the agent is told.
- Local stand-ins (policy mirror, local journal) are labeled **MIRROR**,
  never presented as live.
- Anthropic down = no run. There is no fake agent.

## The deny → correction beat (why it's genuine)

The system prompt gives a $100 bankroll and says "size by conviction,
typically 5–15%". It **never mentions the $5 cap** in `policy/risk.yaml`.
So the first order nearly always exceeds the cap, the gate answers DENY with
the reason and the limit as an `is_error` tool result, and the model resizes
on its own. The correction amount varies run to run — there is no `5.0 → 1.5`
constant anywhere in this codebase. Edit `policy/risk.yaml` live and the next
run enforces the new cap.

## Sponsors

| Sponsor | Role | Mode |
|---|---|---|
| **Pomerium** | Risk gate on `execute_trade` (403=DENY / 200=ALLOW) | Live via `POMERIUM_MCP_URL`, else policy mirror parsing `policy/risk.yaml` (labeled MIRROR; a live failure is announced on the tape) |
| **Nexla** | Trade journal (`log_signal` / `record_fill` via MCP `tools/call`) | Live via `NEXLA_SERVICE_KEY`, else local journal (MIRROR) |
| **Anthropic** | The agent itself (`claude-opus-4-8`, streaming tool-use loop, adaptive thinking) | Live only |
| **Akash** | Optional Monte Carlo sim worker (stretch) | `AKASH_SIM_URL` |

## Verify

```bash
npm run smoke                 # data sources, risk gate vs yaml, P&L math, API ping
curl -N localhost:3001/api/agent   # raw SSE run
npm run build && npm run lint
```

Failure drill for the demo: cut the network mid-run — the source chips flip
to CACHED/DOWN, the agent is told about staleness, and nothing pretends.
