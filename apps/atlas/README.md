> **Monorepo path:** this app lives at `apps/atlas/`. From repo root: `cd apps/atlas && npm install && npm run dev`.
> **Branch:** interactive scenario UX lives on `porter`.

# ATLAS CAPITAL — The First Agent-Run Hedge Fund

Interactive command center: describe a world event (or pick a preset), screen which outcomes are affected, run a **conditioned** Monte Carlo on **Akash**, watch real satellite imagery (Blue Marble globe + Esri tactical close-up), then approve agent-proposed trades that execute through **Pomerium → Zero → Nexla**.

```
SCENARIO → SCREEN → (pick outcomes) → MODEL → SIMULATE → PROPOSE → (approve) → RISK → EXECUTE → SETTLE
  Zero      Nexla                         Nexla   Akash              Pomerium   Zero     Nexla
```

---

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000):

1. Type an event (e.g. *“The Strait of Hormuz closes”*) or click a preset
2. Select outcomes (oil, air travel, …) → **Run simulation**
3. Watch globe → tactical satellite AOI → worldwide propagation
4. Select proposed trades → **Execute selected** (Pomerium deny/resize beat, then fills)

Guaranteed demo: [http://localhost:3000?replay=1](http://localhost:3000?replay=1) auto-runs the full Hormuz pipeline.

---

## Demo script (3 minutes)

1. **0:00** — Idle Blue Marble globe. Hero input: describe a world event + presets.
2. **0:20** — Screen returns affected outcomes. Pick oil + air travel → Run simulation.
3. **0:40** — Camera flies to epicenter; cross-fade to Esri satellite tactical view (geofence, tanker markers, detections).
4. **1:10** — Pull back to globe: frozen red sea lanes, thinning air corridors, price tickers.
5. **1:40** — Proposals appear. Approve 2 → Pomerium denies $5, resizes, Zero fills, Nexla settles.
6. Try Taiwan preset next to prove input-uniqueness.

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
