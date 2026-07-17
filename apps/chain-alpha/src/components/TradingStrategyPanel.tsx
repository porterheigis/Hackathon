"use client";

import type { FundState, TradeProposal } from "@/lib/types";
import { fmtPct, fmtUsdCompact, fmtUsdSigned } from "./format";

const STATUS_META: Record<
  TradeProposal["status"],
  { label: string; cls: string; gate?: string }
> = {
  proposed: { label: "Proposed", cls: "border-atlas-muted/40 text-atlas-muted" },
  blocked: { label: "Pomerium · Blocked", cls: "border-atlas-red/50 text-atlas-red" },
  approved: { label: "Pomerium · Approved", cls: "border-atlas-green/50 text-atlas-green" },
  executed: { label: "Zero · Executed", cls: "border-atlas-green/50 text-atlas-green" },
};

const ACTION_TONE: Record<string, string> = {
  increase: "text-atlas-green",
  reduce: "text-atlas-red",
  hedge: "text-atlas-cyan",
};

function ProposalCard({ p }: { p: TradeProposal }) {
  const meta = STATUS_META[p.status];
  const blocked = p.status === "blocked";
  return (
    <div
      className={`fade-in m-2 rounded-sm border px-2.5 py-2 ${
        blocked ? "border-atlas-red/30" : p.status === "approved" || p.status === "executed" ? "border-atlas-green/25" : "border-atlas-hairline"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.1em] text-atlas-bright uppercase">
          {p.revision === 0 ? "Initial Strategy" : `Revision ${p.revision}`}
        </span>
        <span className={`rounded-sm border px-1.5 py-0.5 font-mono text-[9px] tracking-[0.08em] uppercase ${meta.cls}`}>
          {meta.label}
        </span>
      </div>

      {blocked && p.violatedLimit && (
        <div className="mt-1.5 rounded-sm border border-atlas-red/30 bg-atlas-red/5 px-2 py-1 font-mono text-[10px] text-atlas-red">
          Violated limit · {p.violatedLimit}
        </div>
      )}

      <div className="mt-2 flex flex-col gap-1.5">
        {p.actions.map((a, i) => (
          <div key={i} className="border-l border-atlas-hairline pl-2">
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className={`uppercase ${ACTION_TONE[a.action] ?? "text-atlas-text"}`}>
                {a.action}
              </span>
              <span className="text-atlas-bright">{a.asset}</span>
              <span className="tabular text-atlas-muted">
                {fmtPct(a.positionChangePercent, 0, true)}
              </span>
            </div>
            <p className="mt-0.5 font-sans text-[11px] leading-snug text-atlas-dim">{a.thesis}</p>
          </div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 border-t border-atlas-hairline/60 pt-1.5 font-mono text-[10px]">
        <div className="flex flex-col">
          <span className="text-[8px] tracking-[0.08em] text-atlas-dim uppercase">Exp. P&amp;L</span>
          <span className={`tabular ${p.expectedPnlUsd >= 0 ? "text-atlas-green" : "text-atlas-red"}`}>
            {fmtUsdSigned(p.expectedPnlUsd)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[8px] tracking-[0.08em] text-atlas-dim uppercase">Max DD</span>
          <span className="tabular text-atlas-amber">{fmtPct(p.maxDrawdownPercent, 0)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[8px] tracking-[0.08em] text-atlas-dim uppercase">Notional</span>
          <span className="tabular text-atlas-text">
            {p.notionalUsd ? fmtUsdCompact(p.notionalUsd) : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

export function TradingStrategyPanel({ state }: { state: FundState }) {
  const { proposals, positions, attemptedSize, approvedSize, lastDenial } = state;

  if (proposals.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-3 py-6 text-center font-mono text-[11px] text-atlas-dim">
        Trading Agent proposes a strategy after RISK review. Press Run.
      </div>
    );
  }

  const book = positions.filter((p) => p.kind === "order" || p.kind === "fill" || p.kind === "denial");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {proposals.map((p, i) => (
        <ProposalCard key={`${p.revision}-${i}`} p={p} />
      ))}

      {/* Pomerium gate summary */}
      <div className="mx-2 mt-1 mb-2 rounded-sm border border-atlas-hairline px-2.5 py-2">
        <span className="font-mono text-[9px] tracking-[0.12em] text-atlas-muted uppercase">
          Pomerium Stake Gate
        </span>
        <div className="mt-1.5 grid grid-cols-2 gap-2 font-mono text-[11px]">
          <div className="flex justify-between">
            <span className="text-atlas-dim">Attempted</span>
            <span className="tabular text-atlas-text">
              {attemptedSize != null ? fmtUsdCompact(attemptedSize) : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-atlas-dim">Approved</span>
            <span className="tabular text-atlas-green">
              {approvedSize != null ? fmtUsdCompact(approvedSize) : "—"}
            </span>
          </div>
        </div>
        {lastDenial && (
          <p className="mt-1.5 font-mono text-[10px] text-atlas-red">Denial · {lastDenial}</p>
        )}
      </div>

      {/* Nexla position book */}
      {book.length > 0 && (
        <div className="border-t border-atlas-hairline">
          <div className="px-3 py-1.5 font-mono text-[9px] tracking-[0.12em] text-atlas-muted uppercase">
            Nexla Position Book
          </div>
          {book.slice(-6).map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between gap-2 border-b border-atlas-hairline/40 px-3 py-1 font-mono text-[10px]"
            >
              <span
                className={`uppercase tracking-[0.08em] ${
                  e.kind === "denial" ? "text-atlas-red" : e.kind === "fill" ? "text-atlas-green" : "text-atlas-cyan"
                }`}
              >
                {e.kind}
              </span>
              <span className="text-atlas-muted">{e.side ?? e.market_id ?? ""}</span>
              <span className="tabular text-atlas-text">
                {e.size_usd != null ? fmtUsdCompact(e.size_usd) : e.status ?? ""}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="px-3 py-2 font-mono text-[9px] text-atlas-dim">
        Paper-trading simulation · Zero execution · not investment advice.
      </div>
    </div>
  );
}
