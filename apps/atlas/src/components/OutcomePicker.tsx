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
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="panel mx-3 mb-3 p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="eyebrow">Affected outcomes</p>
        <span className="text-[11px] text-white/30">
          {selected.length} selected
        </span>
      </div>
      <div className="max-h-48 space-y-1 overflow-y-auto">
        {outcomes.map((o, i) => {
          const on = selected.includes(o.id);
          return (
            <motion.button
              key={o.id}
              type="button"
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.2 }}
              onClick={() => toggle(o.id)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
                on ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
                  on
                    ? "border-atlas-accent bg-atlas-accent text-white"
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
                      : "text-white/40"
                }`}
              >
                {o.direction === "up"
                  ? "↑"
                  : o.direction === "down"
                    ? "↓"
                    : "~"}{" "}
                {(o.confidence * 100).toFixed(0)}%
              </span>
            </motion.button>
          );
        })}
      </div>
      <button
        type="button"
        className="btn-primary mt-3 w-full py-2.5 text-[13px]"
        disabled={!selected.length || loading}
        onClick={onRun}
      >
        {loading ? "Simulating…" : "Run simulation"}
      </button>
    </motion.div>
  );
}
