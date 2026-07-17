> **Monorepo path:** this app lives at `apps/chain-alpha/`. From repo root: `cd apps/chain-alpha && npm install && npm run dev`.

# ChainAlpha

**From physical-world disruption to tradable financial exposure.**

ChainAlpha is a supply-chain world-modeling and investment-simulation platform. An analyst describes a real-world disruption, watches its effects propagate across a global supply network, evaluates operational and financial consequences, and generates a risk-controlled paper-trading strategy.

One prompt. Full loop. All four sponsors.

```
INGEST → MODEL → SIMULATE → RISK → EXECUTE → SETTLE
 Zero     Nexla    Akash    Pomerium  Zero     Nexla
```

> **Paper-trading disclaimer:** ChainAlpha is a **simulation and paper-trading** tool for research and demonstration only. It does **not** place real orders, provide investment advice, or guarantee any investment outcome. All positions, fills, and P&L are simulated.

---

## The scenario

ChainAlpha models the semiconductor supply chain. The primary demo scenario:

| Field | Value |
| --- | --- |
| Industry | Semiconductors |
| Company | NVIDIA |
| Event | Major earthquake in northern Taiwan |
| Duration | Three weeks |
| Manufacturing-capacity impact | ≈ **-65%** |
| Taiwan Strait shipping-capacity | ≈ **-40%** |
| Simulation horizon | 12 weeks |

**Default prompt:**

> "A major earthquake shuts down semiconductor production in northern Taiwan for three weeks. Shipping capacity through the Taiwan Strait falls by 40%. Model the operational and financial consequences and propose a hedged trade."

### Secondary shock (re-plan)

Mid-run, a second disruption can be injected:

> "Japan introduces export restrictions on semiconductor manufacturing equipment."

This **invalidates** the existing plan and forces ChainAlpha to **recompute** the world model, simulation, and strategy — demonstrating that the pipeline reacts to new information rather than replaying a fixed script.

---

## Quick start (replay / demo — no credentials)

```bash
npm install
npm run dev
```

Open the **primary demo URL** [http://localhost:3000?replay=1](http://localhost:3000?replay=1) and press **Run**.

Replay mode is guaranteed and fully offline. It needs **no credentials whatsoever** — no Nexla, Pomerium, Zero, Akash, LLM, microphone, or live financial data. It ships the curated Taiwan earthquake scenario, an embedded Monte Carlo simulation, a local Pomerium policy mirror, Zero capability discovery + wallet spend, and a Nexla position book — all deterministic.

---

## What happens during a run

1. **Idle** — Globe at rest, empty position book, simulated wallet. Enter (or accept) the default prompt and press **Run**.
2. **INGEST → MODEL → SIMULATE** — The prompt is parsed into a structured disruption. The world model maps the event onto affected nodes (fab, packaging, materials, equipment, logistics, demand). The Akash worker runs a Monte Carlo supply-chain propagation and fills the expected-value table.
3. **RISK** — The agent proposes a strategy. The oversized version is **blocked by Pomerium** (`max_stake_exceeded`). The loop resizes to a risk-approved stake, which Pomerium then **approves**.
4. **EXECUTE → SETTLE** — The paper trade is executed through Zero; the fill lands in the Nexla position book; the simulated wallet and P&L update.
5. **Re-plan (optional)** — Inject the Japan export-restriction shock to invalidate and recompute the plan.

---

## Architecture

- **Next.js 15** (App Router), **React 19**, **Tailwind 4**
- **react-globe.gl** 3D globe for the world model
- **SSE** streams simulation and agent activity to the UI
- **Orchestrator pipeline:** `INGEST → MODEL → SIMULATE → RISK → EXECUTE → SETTLE`

| Layer | Path | Role |
| --- | --- | --- |
| UI | `src/app/page.tsx`, `src/components/*` | Globe, agent tape (SSE), panels, stage rail |
| Orchestrator | `src/lib/orchestrator.ts` | State machine for the full pipeline |
| Nexla | `src/lib/adapters/nexla.ts` | World model + position book MCP-style tools |
| Pomerium | `src/lib/adapters/pomerium.ts`, `pomerium/config.yaml` | `execute_trade` stake gate |
| Zero | `src/lib/adapters/zero.ts` | Capability discovery, wallet, paper execution |
| Akash | `src/lib/adapters/akash.ts`, `akash/worker/*`, `akash/deploy.sdl.yaml` | Monte Carlo supply-chain sim |
| Data | `data/world-model.json`, `data/fixture-event.json` | Curated graph + replay scenario |
| Schemas | `schemas/*` | Nexset + MCP tool contracts |

---

## Sponsor roles

| Sponsor | Role in ChainAlpha | On screen | In the repo |
| --- | --- | --- | --- |
| **Zero** | Capability discovery, wallet, and paper execution path | Wallet balance + spend + "capability discovered" | `src/lib/adapters/zero.ts` |
| **Nexla** | World model + position book as Nexset-backed MCP tools | Tool-call counter; position book panel | `schemas/nexset-*.json`, `schemas/mcp-tools.json`, adapter |
| **Pomerium** | Risk gate that **blocks the oversized strategy** then **approves the revised one** | ACCESS DENIED banner; allow/deny counters | `pomerium/config.yaml` + adapter logs |
| **Akash** | Monte Carlo supply-chain simulation worker with deterministic fallback | Lease / provider / endpoint in telemetry | `akash/deploy.sdl.yaml`, `akash/worker/` |

---

## Environment variables (live mode)

Copy `.env.example` → `.env.local`. **All optional** — missing vars fall back to demo adapters, and replay mode never depends on any of them.

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
| `CHAINALPHA_LLM_URL` | — (optional) | Live LLM prompt parser endpoint (falls back to deterministic parser) |
| `CHAINALPHA_LLM_KEY` | — (optional) | Auth key for the live LLM parser |

---

## Build

```bash
npm install
npm run build
```

## Test

Smoke-test the sponsor adapters offline (no credentials required):

```bash
npm run test:adapters
```

## Scripts

```bash
npm run dev            # Next.js dev server (Turbopack)
npm run build          # Production build
npm run start          # Serve the production build
npm run lint           # ESLint
npm run test:adapters  # Offline adapter smoke test
npm run sim-worker     # Local Akash worker (requires Python deps)
```

---

## Akash sim worker

### Run the Python worker locally

```bash
cd akash/worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080
```

Then set `AKASH_SIM_URL=http://127.0.0.1:8080`. Endpoints: `GET /health`, `POST /simulate`.

### Deploy the sim worker to Akash

1. Build & push the image from `akash/worker/Dockerfile`.
2. Deploy with `akash/deploy.sdl.yaml` via the [Akash Console](https://console.akash.network/).
3. Set `AKASH_SIM_URL` to the lease endpoint.

If no worker is reachable, ChainAlpha uses a deterministic embedded simulation so replay always works.

---

## Live transport data (observed vessels & aircraft)

ChainAlpha can overlay **observed** live maritime and aviation traffic on the disrupted
region and estimate how much of it is plausibly exposed to the modelled supply-chain shock.
The layer is **additive and optional** — with no keys the whole app runs in REPLAY using
fictionalized fixtures, and every existing behavior is unchanged.

### Supported free providers (verified)

| Layer | Provider | Access | Key | License / terms |
| --- | --- | --- | --- | --- |
| Maritime (AIS) | **AISStream** `wss://stream.aisstream.io/v0/stream` | **Free**, no credit card (GitHub sign-in issues the key) | Server-side `AISSTREAM_API_KEY` **required for live**; replay-until-key | **BETA / best-effort, no SLA** |
| Aviation (ADS-B) | **ADSB.lol** `GET /v2/lat/{lat}/lon/{lon}/dist/{nm}` (≤ 250 nm) | **Free**, open, **no key** | None today (docs note a key *may* be required in future) | **ODbL 1.0** |

We deliberately do **not** use MarineTraffic, Spire, VesselFinder, FlightAware,
FlightRadar24, or OpenSky. If a provider becomes unusable without payment, the layer falls
back to replay — it never silently swaps in a paid provider.

### Required attribution

- **AISStream** branding must be shown wherever live maritime data is displayed.
- **"ADSB.lol — ODbL"** must be shown wherever live aviation data is displayed.
- If a local basemap/tiles are ever added, **OpenStreetMap attribution** ("© OpenStreetMap
  contributors") goes in the same overlay corner as the two feeds above.

### LIVE vs REPLAY

- **Default (no key): everything is REPLAY.** Fictionalized fixtures in
  `data/live-replay/` are played back deterministically (dead-reckoning from
  heading + speed), so `?replay=1` and offline demos are fully reproducible.
- **Live maritime** requires `AISSTREAM_API_KEY` **and** `LIVE_TRANSPORT_ENABLED=true`.
  A short-lived WebSocket subscribes to the region bounding box, collects `PositionReport`
  messages for a few seconds, then closes — there is never a permanent or global socket, and
  the key never reaches the browser.
- **Live aviation** needs no key; it is used whenever `LIVE_TRANSPORT_ENABLED=true`.
- **Providers fail independently.** Maritime may be LIVE while aviation is REPLAY (or vice
  versa). A provider is **never** labelled "live" when fixtures are used.
- The browser talks **only** to `GET /api/live-transport` (and `/status`) — never to a
  provider directly — so credentials stay server-side.

### Data limitations

- AISStream is **beta / best-effort** with no SLA; coverage and latency vary.
- ADSB.lol has **dynamic rate limits**, is community-run, and **may require a key in the
  future** — responses are cached and a replay fallback is always retained.
- Positions are scoped to small predefined regions (`taiwan`, `red-sea`) — ChainAlpha
  **never** requests global live traffic.

### Why exact cargo cannot be inferred

**A position is not a manifest.** Observed AIS/ADS-B tells you *where* a vessel or aircraft
is, not *what it carries*. ChainAlpha therefore never claims a specific asset is "carrying
NVIDIA chips" or any other cargo. The correct, honest framing is **"Observed aircraft near
the affected region"** / **"Observed vessels near the constrained corridor."** Capacity
figures are deliberately **coarse ranges** with published methodology (see
`src/lib/live-transport/exposure.ts`), and are `null` when they cannot be justified.

### Why replay is mandatory

Both feeds are free, best-effort, and rate-limited, and one requires a key. A hard
dependency on them would make the demo non-deterministic and occasionally non-functional.
Replay guarantees the pipeline is reproducible, offline-capable, and always green in
`npm run test:adapters`.

### Setup & demo

```bash
# Works out of the box with NO key (replay):
npm run dev            # then run a scenario; the transport layer is in replay
npm run test:live      # exercises the transport layer offline

# Enable live aviation (no key) + live maritime (free key):
#   .env.local
LIVE_TRANSPORT_ENABLED=true
LIVE_TRANSPORT_REGION=taiwan
AISSTREAM_API_KEY=<your-free-aisstream-key>   # live maritime; omit to keep maritime replay
```

**Demo sequence:** run the Taiwan scenario → the pipeline captures a baseline
("Baseline captured — N vessels, M aircraft"), maps observed assets to the disrupted routes
via the Nexla mirror, flags the exposed subset ("Observed N vessels in region, K potentially
exposed; J aircraft exposed"), folds a rerouting-delay / air-freight-reduction line into the
Akash SIMULATE narrative, and — under the secondary **Japan** shock — re-scores the exposure
worse with lower confidence, lighting up the Japan-facing aircraft.

To **disable all live providers**, set `LIVE_TRANSPORT_ENABLED=false` (or run with
`?replay=1`): the layer stays in replay everywhere.

### Before commercial production

- Review and comply with each provider's **licensing / commercial terms** (AISStream beta
  terms; ADSB.lol **ODbL** share-alike obligations for any redistributed data).
- Negotiate **rate-limit / SLA** guarantees or move to a contracted feed; add backoff and
  quota accounting.
- Add proper **key management** (rotation, per-environment secrets, no keys in the browser).
- Replace fictionalized fixtures and the coarse exposure heuristic with validated,
  auditable models before any figure is used for a real decision.

---

## Known limitations

- **Deterministic fallback data.** Replay and offline modes use curated, deterministic fixtures — not live market or logistics feeds.
- **Curated scenarios.** The Taiwan earthquake and Japan export-restriction scenarios are hand-authored, not discovered from live news.
- **Not full supply-chain accuracy.** The world model is an illustrative approximation of the semiconductor network, not an audited industrial model.
- **Single industry.** Only the semiconductor supply chain is modeled today.
- **Paper only.** No real orders are placed and no investment outcome is guaranteed (see disclaimer above).
