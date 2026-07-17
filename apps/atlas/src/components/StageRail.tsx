"use client";

import { motion } from "framer-motion";
import type { PipelineStage } from "@/lib/types";

interface StageRailProps {
  stages: PipelineStage[];
  activeIndex: number;
  current: PipelineStage;
}

export function StageRail({ stages, activeIndex, current }: StageRailProps) {
  const progress =
    current === "DONE"
      ? 1
      : activeIndex < 0
        ? 0
        : (activeIndex + 0.5) / stages.length;

  return (
    <div className="relative flex h-9 shrink-0 items-center gap-0 border-b border-white/[0.08] px-4 text-[11px]">
      <motion.div
        className="absolute bottom-0 left-0 h-[2px] bg-atlas-accent"
        animate={{ width: `${progress * 100}%` }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
      />
      {stages.map((stage, i) => {
        const done = activeIndex > i || current === "DONE";
        const active = activeIndex === i && current !== "DONE";
        return (
          <div key={stage} className="flex items-center">
            {i > 0 && <span className="mx-2 text-white/15">/</span>}
            <span
              className={`transition-colors duration-200 ${
                active
                  ? "font-medium text-atlas-accent"
                  : done
                    ? "text-white/70"
                    : "text-white/25"
              }`}
            >
              {stage.replace(/_/g, " ").toLowerCase()}
            </span>
          </div>
        );
      })}
    </div>
  );
}
