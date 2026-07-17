"""
ATLAS CAPITAL — Monte Carlo supply-chain disruption simulator.
Deployed on Akash; also runnable locally for demo/replay.
"""

from __future__ import annotations

import math
import os
import time
import uuid
from typing import Any

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="ATLAS Monte Carlo Worker", version="1.0.0")

N_SIMS = int(os.getenv("N_SIMS", "5000"))
WORKER_NAME = os.getenv("WORKER_NAME", "atlas-monte-carlo")
LEASE_ID = os.getenv("AKASH_LEASE_ID", f"local-{uuid.uuid4().hex[:8]}")
PROVIDER = os.getenv("AKASH_PROVIDER", "local-embedded")


class Edge(BaseModel):
    id: str
    source: str = Field(alias="from")
    target: str = Field(alias="to")
    decay: float
    commodity: str | None = None

    model_config = {"populate_by_name": True}


class Market(BaseModel):
    id: str
    question: str
    nodes: list[str]
    side: str = "YES"
    yes_price: float | None = None


class SimRequest(BaseModel):
    epicenter_node: str
    implied_probability: float
    edges: list[Edge]
    markets: list[Market]
    n_sims: int | None = None
    seed: int | None = 42


class MarketEV(BaseModel):
    market_id: str
    question: str
    side: str
    mean_impact: float
    p5: float
    p95: float
    expected_value: float
    confidence: float
    market_price: float | None = None
    edge: float | None = None


class SimResponse(BaseModel):
    run_id: str
    lease_id: str
    provider: str
    worker: str
    n_sims: int
    elapsed_ms: int
    epicenter: str
    node_exposure: dict[str, float]
    propagation_order: list[str]
    markets: list[MarketEV]


def build_adjacency(edges: list[Edge]) -> dict[str, list[tuple[str, float]]]:
    adj: dict[str, list[tuple[str, float]]] = {}
    for e in edges:
        adj.setdefault(e.source, []).append((e.target, e.decay))
    return adj


def propagate_once(
    rng: np.random.Generator,
    epicenter: str,
    p_hit: float,
    adj: dict[str, list[tuple[str, float]]],
    max_hops: int = 5,
) -> dict[str, float]:
    """Single Monte Carlo path: Bernoulli hit at epicenter, decay along edges."""
    exposure: dict[str, float] = {}
    if rng.random() > p_hit:
        return exposure

    frontier = [(epicenter, 1.0, 0)]
    visited: set[str] = set()

    while frontier:
        node, strength, hops = frontier.pop(0)
        if node in visited or hops > max_hops:
            continue
        visited.add(node)
        exposure[node] = max(exposure.get(node, 0.0), strength)
        for neighbor, decay in adj.get(node, []):
            if neighbor in visited:
                continue
            # Stochastic transmission
            transmit_p = decay * strength
            if rng.random() < min(1.0, transmit_p + 0.15):
                frontier.append((neighbor, strength * decay, hops + 1))

    return exposure


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "worker": WORKER_NAME,
        "lease_id": LEASE_ID,
        "provider": PROVIDER,
    }


@app.post("/simulate", response_model=SimResponse)
def simulate(req: SimRequest) -> SimResponse:
    t0 = time.perf_counter()
    n = req.n_sims or N_SIMS
    rng = np.random.default_rng(req.seed)
    adj = build_adjacency(req.edges)

    # Collect exposures across sims
    node_sums: dict[str, float] = {}
    hop_counts: dict[str, int] = {}

    for _ in range(n):
        exp = propagate_once(rng, req.epicenter_node, req.implied_probability, adj)
        for node, strength in exp.items():
            node_sums[node] = node_sums.get(node, 0.0) + strength
            hop_counts[node] = hop_counts.get(node, 0) + 1

    node_exposure = {k: v / n for k, v in node_sums.items()}
    propagation_order = sorted(
        node_exposure.keys(),
        key=lambda k: (-node_exposure[k], k),
    )

    market_results: list[MarketEV] = []
    for m in req.markets:
        impacts = []
        for _ in range(min(n, 2000)):
            exp = propagate_once(rng, req.epicenter_node, req.implied_probability, adj)
            impact = float(np.mean([exp.get(nid, 0.0) for nid in m.nodes]) if m.nodes else 0.0)
            impacts.append(impact)

        arr = np.array(impacts)
        mean_impact = float(arr.mean())
        p5 = float(np.percentile(arr, 5))
        p95 = float(np.percentile(arr, 95))
        # Map disruption impact → fair YES probability tilt
        fair = min(0.95, max(0.05, req.implied_probability * (0.7 + 0.6 * mean_impact)))
        market_price = m.yes_price if m.yes_price is not None else 0.5
        edge = fair - market_price
        # EV per $1 stake on YES
        ev = edge
        confidence = float(min(0.95, 0.4 + abs(edge) * 2 + mean_impact * 0.3))

        market_results.append(
            MarketEV(
                market_id=m.id,
                question=m.question,
                side=m.side,
                mean_impact=round(mean_impact, 4),
                p5=round(p5, 4),
                p95=round(p95, 4),
                expected_value=round(ev, 4),
                confidence=round(confidence, 4),
                market_price=market_price,
                edge=round(edge, 4),
            )
        )

    market_results.sort(key=lambda x: abs(x.expected_value), reverse=True)
    elapsed_ms = int((time.perf_counter() - t0) * 1000)

    return SimResponse(
        run_id=f"sim-{uuid.uuid4().hex[:10]}",
        lease_id=LEASE_ID,
        provider=PROVIDER,
        worker=WORKER_NAME,
        n_sims=n,
        elapsed_ms=elapsed_ms,
        epicenter=req.epicenter_node,
        node_exposure={k: round(v, 4) for k, v in node_exposure.items()},
        propagation_order=propagation_order,
        markets=market_results,
    )


# Silence unused import warning for math (kept for future scoring)
_ = math
