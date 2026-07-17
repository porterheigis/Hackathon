# VERITAS DESK

**The agent-run trading desk — for real this time.**

Same concept as ATLAS CAPITAL, with the script removed. The agent is a
**headless Claude Code session** that reads **today's real news wire**, picks
**real Polymarket markets at live prices**, sizes a position by conviction,
gets **rejected by a live risk gate**, reads the rejection, resizes **by its
own decision**, and paper-fills at the real quote. Every run is different.
Nothing is choreographed.

## Run it

```bash
cd apps/veritas
npm install
npm run dev                  # http://localhost:3001
```

**No API key.** The engine spawns `claude -p …` (headless Claude Code) — it
uses your Claude Code login/subscription. Requirements: the `claude` CLI on
PATH (or `VERITAS_CLAUDE_BIN`) and a logged-in session. `.env.example` lists
the optional knobs (model alias, budget, timeout, sponsor credentials).

Hit **RUN AGENT**. The center tape streams the model's thinking and prose
live from the NDJSON stream; tool activity is narrated by the server as
Claude Code calls the MCP tools; left is the real BBC wire; right is the
live Polymarket board and the mark-to-market position book.

## How the engine works

```
RUN AGENT → /api/agent spawns:  claude -p <kickoff>
              --output-format stream-json --include-partial-messages
              --mcp-config <inline: .veritas/mcp-server.cjs> --strict-mcp-config
              --tools "" --allowedTools mcp__veritas__*
              --append-system-prompt <desk charter> --max-budget-usd 5

  stream-json (thinking/text deltas) ──▶ reasoning tape (SSE)
  mcp__veritas__* tool calls ──▶ scripts/veritas-mcp.ts ──▶ POST /api/tools/<name>
                                  (gate, fills, journal, tape events — all server-side)
```

Adapted from the `batch-seo.ts` Terminal-window orchestration pattern, minus
what headless makes unnecessary: no window, no output-file polling, no
kill-by-tty — the `-p` process exits by itself; a 240s orchestrator deadline
kills it if it hangs. Built-in tools are disabled (`--tools ""`): the agent
can only trade through the gated MCP tools.

The MCP server (`scripts/veritas-mcp.ts`) is pre-bundled to plain JS
(`npm run mcp:build`, auto-run by dev/start/smoke) because `claude -p`
snapshots its tool set immediately at startup — a tsx cold start loses that
race and the session would run tool-less. The ~100ms bundle wins it.

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
- Claude Code unreachable or not logged in = no run, explicit error.
  There is no fake agent.

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
| **Anthropic** | The agent itself — headless Claude Code driving the `mcp__veritas__*` MCP tools | Live only (your Claude Code session) |
| **Akash** | Optional Monte Carlo sim worker (stretch) | `AKASH_SIM_URL` |

## Verify

```bash
npm run smoke                 # data sources, risk gate vs yaml, P&L math,
                              # claude CLI, MCP handshake, headless round-trip
curl -N localhost:3001/api/agent   # raw SSE run (server must be running)
npm run build && npm run lint
```

Failure drill for the demo: cut the network mid-run — the source chips flip
to CACHED/DOWN, the agent is told about staleness, and nothing pretends.
