"use client";

import { useEffect, useState } from "react";

export function TopBar({
  running,
  onRun,
  walletUsd,
  markPnl,
  denyText,
}: {
  running: boolean;
  onRun: () => void;
  walletUsd: number;
  markPnl: number;
  denyText: string | null;
}) {
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () => setClock(new Date().toISOString().slice(11, 19));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const pnlColor = markPnl > 0 ? "text-v-green" : markPnl < 0 ? "text-v-red" : "text-v-muted";

  return (
    <header className="flex items-center gap-4 border-b border-v-hairline bg-v-panel px-4 py-2.5">
      <div>
        <div className="text-sm font-bold tracking-[0.3em] text-v-bright">
          VERITAS<span className="text-v-amber"> DESK</span>
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-v-muted">
          agent-run paper desk · live wire · real prices
        </div>
      </div>

      {denyText && (
        <div className="fade-in ml-2 border border-v-red bg-v-red/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-v-red">
          ⛔ access denied — {denyText}
        </div>
      )}

      <div className="ml-auto flex items-center gap-5">
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.2em] text-v-muted">wallet</div>
          <div className="tabular text-sm text-v-bright">${walletUsd.toFixed(2)}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.2em] text-v-muted">mark p&l</div>
          <div className={`tabular text-sm ${pnlColor}`}>
            {markPnl >= 0 ? "+" : ""}
            {markPnl.toFixed(2)}
          </div>
        </div>
        <div className="tabular text-xs text-v-muted">{clock} UTC</div>
        <button
          onClick={onRun}
          disabled={running}
          className={`border px-4 py-2 text-xs font-bold uppercase tracking-[0.25em] transition-colors ${
            running
              ? "cursor-wait border-v-amber-dim text-v-amber-dim"
              : "border-v-amber text-v-amber hover:bg-v-amber hover:text-v-bg"
          }`}
        >
          {running ? "running…" : "run agent"}
        </button>
      </div>
    </header>
  );
}
