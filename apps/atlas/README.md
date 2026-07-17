> **Monorepo path:** this app lives at `apps/atlas/`. From repo root: `cd apps/atlas && npm install && npm run dev`.

# ATLAS CAPITAL — The First Agent-Run Hedge Fund

Palantir-style command center: a 3D globe world model maps live events onto a supply-chain graph, runs Monte Carlo impact sims on **Akash**, risk-gates every trade through **Pomerium**, governs positions via **Nexla** Nexsets, and executes micro-stakes from its own **Zero** wallet.

One button. Full loop. All four sponsors.

```
INGEST → MODEL → SIMULATE → RISK → EXECUTE → SETTLE
 Zero     Nexla    Akash    Pomerium  Zero     Nexla
```

---

## Quick start (demo / replay — no credentials)

```bash
npm install
npm run dev
```

Open [http://localhost:3000?replay=1](http://localhost:3000?replay=1) and press **RUN SIMULATION**.

Replay mode is guaranteed: fixture Red Sea event, embedded Monte Carlo, local Pomerium policy mirror, Zero capability discovery + wallet spend, Nexla position book — all offline.

---

## Demo script (3 minutes)

1. **0:00** — Idle globe, `FUND DORMANT — AWAITING MANDATE`, wallet $5.00, empty book. Press **RUN SIMULATION**.
2. **0:30** — Stage rail lights `INGEST` → `MODEL` → `SIMULATE`. Tape streams plan/act/observe. Epicenter ring at Bab el-Mandeb; arcs propagate amber→red. EV table fills from Akash worker.
3. **1:30** — `RISK`: agent tries $5.00 → banner flips **ACCESS DENIED — POMERIUM: max_stake_exceeded**. Loop resizes to $1.50 → ALLOW.
4. **2:00** — `EXECUTE` / `SETTLE`: Zero fill lands in Nexla position book; wallet ticks down; P&L marks. Closing line on tape: *"No human placed a trade…"*
5. Press again for a second full cycle.

---

## Architecture

| Layer | Path | Role |
| --- | --- | --- |
| UI | `src/app/page.tsx`, `src/components/*` | Globe, agent tape (SSE), fund panels, stage rail |
| Orchestrator | `src/lib/orchestrator.ts` | State machine for the full pipeline |
| Nexla | `src/lib/adapters/nexla.ts` | World model + position book MCP-style tools |
| Pomerium | `src/lib/adapters/pomerium.ts`, `pomerium/config.yaml` | `execute_trade` stake gate |
| Zero | `src/lib/adapters/zero.ts` | Odds/news/execution + wallet telemetry |
| Akash | `src/lib/adapters/akash.ts`, `akash/worker/*`, `akash/deploy.sdl.yaml` | Monte Carlo sim |
| Data | `data/world-model.json` (~40 nodes), `data/fixture-event.json` | Curated graph + replay event |
| Schemas | `schemas/*` | Nexset + MCP tool contracts |

---

## Environment variables (live mode)

Copy `.env.example` → `.env.local`. All optional — missing vars fall back to demo adapters.

| Variable | Sponsor | Purpose |
| --- | --- | --- |
| `NEXLA_SERVICE_KEY` | Nexla | Live MCP ToolSet calls |
| `NEXLA_MCP_URL` | Nexla | Override MCP endpoint |
| `POMERIUM_MCP_URL` | Pomerium | Live risk-gate URL |
| `POMERIUM_SERVICE_TOKEN` | Pomerium | Service-account JWT |
| `POMERIUM_MAX_STAKE` | Pomerium | Stake limit (default `2.0`) |
| `ZERO_API_URL` | Zero | Zero gateway base URL |
| `ZERO_WALLET_KEY` | Zero | Wallet auth for pay-per-call |
| `ZERO_WALLET_USD` | Zero | Starting balance (default `5`) |
| `AKASH_SIM_URL` | Akash | Deployed worker URL (e.g. `https://…`) |
| `AKASH_LEASE_ID` | Akash | Lease id for telemetry |
| `AKASH_PROVIDER` | Akash | Provider name for telemetry |

### Optional: run Python worker locally

```bash
cd akash/worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080
```

Then set `AKASH_SIM_URL=http://127.0.0.1:8080`.

### Deploy sim worker to Akash

1. Build & push image from `akash/worker/Dockerfile`
2. Deploy with `akash/deploy.sdl.yaml` via [Akash Console](https://console.akash.network/)
3. Set `AKASH_SIM_URL` to the lease endpoint

---

## Sponsor eligibility proof

| Sponsor | In the loop | On screen | In the repo |
| --- | --- | --- | --- |
| **Zero.xyz** | Sole odds/news/execution path — no Polymarket API keys | Wallet + spend + “capability discovered” | `src/lib/adapters/zero.ts` |
| **Nexla** | World model + position book as Nexset-backed tools | Tool-call counter; position book panel | `schemas/nexset-*.json`, `schemas/mcp-tools.json`, adapter |
| **Pomerium** | `execute_trade` denied above max stake; resized allow | ACCESS DENIED banner; A/D counters | `pomerium/config.yaml` + adapter logs |
| **Akash** | Only component that computes EV | Lease / provider / endpoint in telemetry | `akash/deploy.sdl.yaml`, `akash/worker/` |

---

## Design system

- BG `#0a0e14` · hairline `#1c2430` · cyan `#39d3f5` · amber `#ffb454` · red `#ff5c5c` (denials/losses) · green `#2fd682` (fills/profit)
- IBM Plex Mono for data; Inter for prose
- No floating cards, shadows, or decorative gradients (globe atmosphere only)
- Motion only on data change (150–200ms)

---

## Scripts

```bash
npm run dev          # Next.js command center
npm run build        # Production build
npm run test:adapters  # Smoke-test adapters offline
npm run sim-worker   # Local Akash worker (requires Python deps)
```

---

## Phase gates (build verification)

| Gate | Status |
| --- | --- |
| 0 Productize (world model, schemas, PPL, SDL, orchestrator) | PASS |
| 1 Scaffold + design tokens + idle screen | PASS |
| 2 Nexla adapters (local MCP contract) | PASS |
| 3 Pomerium deny oversized / allow resized | PASS |
| 4 Zero fixture path + capability discovery | PASS |
| 5 Akash worker + embedded fallback | PASS |
| 6 Full UI + RUN SIMULATION E2E | PASS |
| 7 Replay `?replay=1` + README | PASS |
