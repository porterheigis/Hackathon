"use client";

import { motion } from "framer-motion";
import type { TimelinePhase } from "@/lib/types";

interface SimTheaterHUDProps {
  clockLabel: string;
  phase: TimelinePhase | null;
  progress: number;
  nSims?: number;
  vesselCount?: number;
  assetCount?: number;
  onSkip: () => void;
}

export function SimTheaterHUD({
  clockLabel,
  phase,
  progress,
  nSims,
  vesselCount,
  assetCount,
  onSkip,
}: SimTheaterHUDProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.25 }}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 p-4"
    >
      <div className="pointer-events-auto mx-auto max-w-2xl rounded-2xl border border-white/[0.1] bg-atlas-bg/75 px-4 py-3 shadow-2xl backdrop-blur-xl">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] tabular tracking-wide text-atlas-accent">
              {clockLabel}
              {phase ? (
                <span className="ml-2 uppercase text-white/35">
                  {phase.id}
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 truncate text-[13px] text-white/85">
              {phase?.caption ?? "Simulating future state…"}
            </p>
          </div>
          <button
            type="button"
            onClick={onSkip}
            className="shrink-0 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/70 transition hover:bg-white/[0.08] hover:text-white"
          >
            Skip
          </button>
        </div>

        <div className="h-1 overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className="h-full rounded-full bg-atlas-accent transition-[width] duration-100 ease-linear"
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-white/35">
          {nSims != null && <span>{nSims.toLocaleString()} sims</span>}
          {vesselCount != null && <span>{vesselCount} vessels tracked</span>}
          {assetCount != null && <span>{assetCount} units in theater</span>}
        </div>
      </div>
    </motion.div>
  );
}
