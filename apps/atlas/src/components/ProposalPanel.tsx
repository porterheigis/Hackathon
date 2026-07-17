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
}

export function ProposalPanel({
  proposals,
  selected,
  onChange,
  onExecute,
  loading,
  denial,
}: ProposalPanelProps) {
  if (!proposals.length) {
    return (
      <div className="px-3 py-4 text-[12px] text-white/30">
        No positions yet — run a simulation.
      </div>
    );
  }

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-white/[0.08] px-3 py-2">
        <p className="eyebrow">Proposed trades</p>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {proposals.map((p, i) => {
          const on = selected.includes(p.id);
          return (
            <motion.button
              key={p.id}
              type="button"
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.2 }}
              onClick={() => toggle(p.id)}
              className={`w-full rounded-[10px] border p-3 text-left transition-colors ${
                on
                  ? "border-atlas-accent/40 bg-atlas-accent/10"
                  : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]"
              } ${denial && i === 0 ? "deny-pulse border-atlas-red/50" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[12px] leading-snug text-white/90">
                  {p.question}
                </p>
                <span
                  className={`font-mono text-[11px] tabular ${
                    p.ev >= 0 ? "text-atlas-green" : "text-atlas-red"
                  }`}
                >
                  EV {p.ev >= 0 ? "+" : ""}
                  {p.ev.toFixed(3)}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3 font-mono text-[10px] text-white/40">
                <span>{p.side}</span>
                <span>${p.size_usd.toFixed(2)}</span>
                <span>conf {(p.confidence * 100).toFixed(0)}%</span>
              </div>
              <p className="mt-1.5 text-[11px] text-white/35">{p.rationale}</p>
            </motion.button>
          );
        })}
      </div>
      {denial && (
        <div className="mx-3 mb-2 rounded-lg border border-atlas-red/30 bg-atlas-red/10 px-3 py-2 text-[11px] text-atlas-red">
          {denial}
        </div>
      )}
      <div className="border-t border-white/[0.08] p-3">
        <button
          type="button"
          className="btn-primary w-full py-2.5 text-[13px]"
          disabled={!selected.length || loading}
          onClick={onExecute}
        >
          {loading ? "Executing…" : `Execute selected (${selected.length})`}
        </button>
      </div>
    </div>
  );
}
