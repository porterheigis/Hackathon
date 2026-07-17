"use client";

import { motion } from "framer-motion";
import type { AffectedOutcome } from "@/lib/types";

interface OutcomePickerProps {
  outcomes: AffectedOutcome[];
  selected: string[];
  onChange: (ids: string[]) => void;
  onRun: () => void;
  loading?: boolean;
}

export function OutcomePicker({
  outcomes,
  selected,
  onChange,
  onRun,
  loading,
}: OutcomePickerProps) {
  const toggle = (id: string) => {
    if (loading) return;
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      className="panel mx-3 mb-3 p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="eyebrow">Affected outcomes</p>
        <span className="text-[11px] text-white/45">
          {selected.length} selected
        </span>
      </div>
      <div className="max-h-48 space-y-1 overflow-y-auto scrollbar-atlas">
        {outcomes.map((o) => {
          const on = selected.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => toggle(o.id)}
              disabled={loading}
              aria-pressed={on}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors duration-150 focus-visible:outline focus-visible:outline-1 focus-visible:outline-atlas-cyan disabled:opacity-50 ${
                on ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
                  on
                    ? "border-atlas-cyan bg-atlas-cyan text-atlas-bg"
                    : "border-white/20 text-transparent"
                }`}
              >
                ✓
              </span>
              <span className="flex-1 text-[13px] text-white/90">{o.name}</span>
              <span
                className={`font-mono text-[10px] tabular ${
                  o.direction === "up"
                    ? "text-atlas-red"
                    : o.direction === "down"
                      ? "text-atlas-green"
                      : "text-white/45"
                }`}
              >
                {o.direction === "up"
                  ? "up ↑"
                  : o.direction === "down"
                    ? "down ↓"
                    : "~"}{" "}
                {(o.confidence * 100).toFixed(0)}%
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="btn-primary mt-3 w-full py-2.5 text-[13px]"
        disabled={!selected.length || loading}
        onClick={onRun}
        aria-busy={loading}
      >
        {loading ? "Simulating…" : "Run simulation"}
      </button>
    </motion.div>
  );
}
