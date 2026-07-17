"use client";

import type { FundState } from "@/lib/types";

interface FundPanelProps {
  state: FundState;
}

function money(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

export function FundPanel({ state }: FundPanelProps) {
  const fills = state.positions.filter((p) => p.kind === "fill");
  const denials = state.positions.filter((p) => p.kind === "denial");
  const markPnl =
    state.selectedMarket && state.approvedSize
      ? (state.selectedMarket.edge ?? 0) * state.approvedSize * 0.35
      : 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Wallet */}
      <section className="border-b border-atlas-hairline px-3 py-3">
        <h2 className="font-mono text-[10px] tracking-[0.15em] text-atlas-muted uppercase">
          Zero Wallet
        </h2>
        <p className="mt-1 font-mono text-2xl tabular text-atlas-bright">
          {money(state.telemetry.zeroWalletUsd)}
        </p>
        <p className="mt-1 font-mono text-[11px] tabular text-atlas-dim">
          Spend {money(state.telemetry.zeroSpendUsd)}
        </p>
        {state.telemetry.capabilitiesDiscovered.length > 0 && (
          <div className="fade-in mt-2">
            <p className="font-mono text-[10px] tracking-[0.12em] text-atlas-cyan uppercase">
              Capability discovered
            </p>
            <ul className="mt-1 space-y-0.5">
              {state.telemetry.capabilitiesDiscovered.map((c) => (
                <li key={c} className="font-mono text-[11px] text-atlas-text">
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* EV table */}
      <section className="border-b border-atlas-hairline px-3 py-3">
        <h2 className="font-mono text-[10px] tracking-[0.15em] text-atlas-muted uppercase">
          Simulation EV
        </h2>
        {!state.sim ? (
          <p className="mt-2 font-mono text-[11px] text-atlas-dim">— awaiting sim</p>
        ) : (
          <table className="mt-2 w-full font-mono text-[11px]">
            <thead>
              <tr className="text-left text-atlas-dim">
                <th className="pb-1 font-medium">Market</th>
                <th className="pb-1 text-right font-medium">Edge</th>
                <th className="pb-1 text-right font-medium">Conf</th>
              </tr>
            </thead>
            <tbody>
              {state.sim.markets.map((m) => (
                <tr
                  key={m.market_id}
                  className={`border-t border-atlas-hairline/50 ${
                    state.selectedMarket?.market_id === m.market_id
                      ? "text-atlas-cyan"
                      : "text-atlas-text"
                  }`}
                >
                  <td className="max-w-[9rem] truncate py-1" title={m.question}>
                    {m.market_id.replace("mkt-", "")}
                  </td>
                  <td
                    className={`py-1 text-right tabular ${
                      (m.edge ?? 0) >= 0 ? "text-atlas-green" : "text-atlas-red"
                    }`}
                  >
                    {(m.edge ?? 0).toFixed(3)}
                  </td>
                  <td className="py-1 text-right tabular text-atlas-muted">
                    {m.confidence.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Positions */}
      <section className="border-b border-atlas-hairline px-3 py-3">
        <h2 className="font-mono text-[10px] tracking-[0.15em] text-atlas-muted uppercase">
          Position Book · Nexset
        </h2>
        {fills.length === 0 && denials.length === 0 ? (
          <p className="mt-2 font-mono text-[11px] text-atlas-dim">Empty</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {denials.map((d) => (
              <li
                key={d.id}
                className="fade-in font-mono text-[11px] text-atlas-red"
              >
                DENIED {d.market_id} ${d.size_usd?.toFixed(2)}
              </li>
            ))}
            {fills.map((f) => (
              <li
                key={f.id}
                className="fade-in font-mono text-[11px] text-atlas-green"
              >
                FILL {f.side} {f.market_id} ${f.size_usd?.toFixed(2)} @{" "}
                {f.price?.toFixed(2)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* P&L */}
      <section className="px-3 py-3">
        <h2 className="font-mono text-[10px] tracking-[0.15em] text-atlas-muted uppercase">
          Mark P&amp;L
        </h2>
        <p
          className={`mt-1 font-mono text-xl tabular ${
            markPnl >= 0 ? "text-atlas-green" : "text-atlas-red"
          }`}
        >
          {markPnl >= 0 ? "+" : ""}
          {money(markPnl)}
        </p>
        {state.approvedSize != null && (
          <p className="mt-1 font-mono text-[11px] text-atlas-dim">
            Stake {money(state.approvedSize)}
            {state.attemptedSize != null &&
              state.attemptedSize !== state.approvedSize && (
                <span className="text-atlas-amber">
                  {" "}
                  (resized from {money(state.attemptedSize)})
                </span>
              )}
          </p>
        )}
      </section>
    </div>
  );
}
