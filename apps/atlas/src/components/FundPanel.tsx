"use client";

import type { FundState } from "@/lib/types";

interface FundPanelProps {
  state: FundState;
  onNewScenario?: () => void;
  showNewScenario?: boolean;
}

function money(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

export function FundPanel({
  state,
  onNewScenario,
  showNewScenario,
}: FundPanelProps) {
  const fills = state.positions.filter((p) => p.kind === "fill");
  const denials = state.positions.filter((p) => p.kind === "denial");
  const markPnl =
    state.selectedMarket && state.approvedSize
      ? (state.selectedMarket.edge ?? 0) * state.approvedSize * 0.35
      : fills.reduce((a, f) => a + (f.size_usd ?? 0) * 0.05, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-white/[0.08] px-3 py-3">
          <p className="eyebrow">Zero wallet</p>
          <p className="mt-1 font-mono text-2xl tabular text-white">
            {money(state.telemetry.zeroWalletUsd)}
          </p>
          <p className="mt-1 font-mono text-[11px] tabular text-white/35">
            Spend {money(state.telemetry.zeroSpendUsd)}
          </p>
        </section>

        <section className="border-b border-white/[0.08] px-3 py-3">
          <p className="eyebrow">Simulation EV</p>
          {!state.sim ? (
            <p className="mt-2 text-[12px] text-white/30">
              Awaiting simulation
            </p>
          ) : (
            <table className="mt-2 w-full font-mono text-[11px]">
              <thead>
                <tr className="text-left text-white/30">
                  <th className="pb-1 font-medium">Market</th>
                  <th className="pb-1 text-right font-medium">Edge</th>
                  <th className="pb-1 text-right font-medium">Conf</th>
                </tr>
              </thead>
              <tbody>
                {state.sim.markets.map((m) => (
                  <tr
                    key={m.market_id}
                    className="border-t border-white/[0.04] text-white/80"
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
                    <td className="py-1 text-right tabular text-white/35">
                      {m.confidence.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="border-b border-white/[0.08] px-3 py-3">
          <p className="eyebrow">Position book</p>
          {fills.length === 0 && denials.length === 0 ? (
            <p className="mt-2 text-[12px] text-white/30">
              No positions yet — run a simulation.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {denials.map((d) => (
                <li key={d.id} className="font-mono text-[11px] text-atlas-red">
                  Denied {d.market_id} ${d.size_usd?.toFixed(2)}
                </li>
              ))}
              {fills.map((f) => (
                <li key={f.id} className="font-mono text-[11px] text-atlas-green">
                  Fill {f.side} {f.market_id} ${f.size_usd?.toFixed(2)} @{" "}
                  {f.price?.toFixed(2)}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="px-3 py-3">
          <p className="eyebrow">Mark P&amp;L</p>
          <p
            className={`mt-1 font-mono text-xl tabular ${
              markPnl >= 0 ? "text-atlas-green" : "text-atlas-red"
            }`}
          >
            {markPnl >= 0 ? "+" : ""}
            {money(markPnl)}
          </p>
        </section>
      </div>

      {showNewScenario && onNewScenario && (
        <div className="border-t border-white/[0.08] p-3">
          <button
            type="button"
            className="btn-primary w-full py-2.5 text-[13px]"
            onClick={onNewScenario}
          >
            New scenario
          </button>
        </div>
      )}
    </div>
  );
}
