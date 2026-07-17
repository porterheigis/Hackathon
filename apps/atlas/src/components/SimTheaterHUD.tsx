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
      className="sim-hud-wrap"
    >
      <div className="sim-hud hud-panel">
        <div className="sim-hud-header">
          <div>
            <p className="sim-hud-clock">
              {clockLabel}
              {phase ? (
                <span>
                  {phase.id}
                </span>
              ) : null}
            </p>
            <p className="sim-hud-caption">
              {phase?.caption ?? "Simulating future state…"}
            </p>
          </div>
          <button
            type="button"
            onClick={onSkip}
            className="sim-skip"
          >
            Skip
          </button>
        </div>

        <div className="sim-progress">
          <div
            className="sim-progress-fill"
            style={{
              width: `${Math.min(100, progress * 100)}%`,
              transition: "width 80ms linear",
            }}
          />
        </div>

        <div className="sim-stats">
          {nSims != null && <span>{nSims.toLocaleString()} sims</span>}
          {vesselCount != null && <span>{vesselCount} vessels tracked</span>}
          {assetCount != null && <span>{assetCount} units in theater</span>}
        </div>
      </div>
    </motion.div>
  );
}
