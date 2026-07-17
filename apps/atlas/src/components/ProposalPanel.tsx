"use client";

import { motion } from "framer-motion";
import type { TradeProposal } from "@/lib/types";

interface ProposalPanelProps {
  proposals: TradeProposal[];
  selected: string[];
  onChange: (ids: string[]) => void;
  onExecute: () => void;
  loading?: boolean;
  denial?: string | null;
  onNewScenario?: () => void;
}

export function ProposalPanel({
  proposals,
  selected,
  onChange,
  onExecute,
  loading,
  denial,
  onNewScenario,
}: ProposalPanelProps) {
  if (!proposals.length) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="px-3 py-4 text-[12px] text-white/45"
      >
        No positions yet — run a simulation.
      </motion.div>
    );
  }

  const toggle = (id: string) => {
    if (loading) return;
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  };

  const selectAll = () => {
    if (!loading) onChange(proposals.map((p) => p.id));
  };
  const selectNone = () => {
    if (!loading) onChange([]);
  };

  const totalStake = proposals
    .filter((p) => selected.includes(p.id))
    .reduce((sum, p) => sum + p.size_usd, 0);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex items-center justify-between border-b border-atlas-hairline px-3 py-2">
        <p className="eyebrow">Proposed trades</p>
        <div className="flex items-center gap-2 text-[11px]">
          <button
            type="button"
            className="text-white/45 hover:text-white/70 focus-visible:outline focus-visible:outline-1 focus-visible:outline-atlas-cyan disabled:opacity-40"
            onClick={selectAll}
            disabled={loading}
          >
            All
          </button>
          <span className="text-white/15">·</span>
          <button
            type="button"
            className="text-white/45 hover:text-white/70 focus-visible:outline focus-visible:outline-1 focus-visible:outline-atlas-cyan disabled:opacity-40"
            onClick={selectNone}
            disabled={loading}
          >
            None
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 scrollbar-atlas">
        {proposals.map((p) => {
          const on = selected.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p.id)}
              disabled={loading}
              aria-pressed={on}
              className={`w-full rounded-[10px] border p-3 text-left transition-colors duration-150 focus-visible:outline focus-visible:outline-1 focus-visible:outline-atlas-cyan disabled:opacity-60 ${
                on
                  ? "border-atlas-cyan/40 bg-atlas-cyan/10"
                  : "border-atlas-hairline bg-white/[0.02] hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-start gap-2">
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                    on
                      ? "border-atlas-cyan bg-atlas-cyan text-atlas-bg"
                      : "border-white/20 text-transparent"
                  }`}
                >
                  ✓
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[12px] leading-snug text-white/90">
                      {p.question}
                    </p>
                    <span
                      className={`shrink-0 font-mono text-[11px] tabular ${
                        p.ev >= 0 ? "text-atlas-green" : "text-atlas-red"
                      }`}
                    >
                      EV {p.ev >= 0 ? "+" : ""}
                      {p.ev.toFixed(3)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 font-mono text-[10px] text-white/45">
                    <span>{p.side}</span>
                    <span>${p.size_usd.toFixed(2)}</span>
                    <span>conf {(p.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-white/45">{p.rationale}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {denial && (
        <div className="mx-3 mb-2 rounded-lg border border-atlas-red/30 bg-atlas-red/10 px-3 py-2 text-[11px] text-atlas-red">
          {denial}
        </div>
      )}
      <div className="space-y-2 border-t border-atlas-hairline p-3">
        <button
          type="button"
          className="btn-primary w-full py-2.5 text-[13px]"
          disabled={!selected.length || loading}
          onClick={onExecute}
        >
          {loading
            ? "Executing…"
            : `Execute selected (${selected.length}) · $${totalStake.toFixed(2)}`}
        </button>
        {onNewScenario && (
          <button
            type="button"
            className="btn-secondary w-full py-2 text-[12px]"
            disabled={loading}
            onClick={onNewScenario}
          >
            New scenario
          </button>
        )}
      </div>
    </motion.div>
  );
}
