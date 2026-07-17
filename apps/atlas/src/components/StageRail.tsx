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
    <div
      className="relative flex h-9 shrink-0 items-center gap-0 overflow-x-auto border-b border-atlas-hairline px-4 text-[11px] scrollbar-atlas"
      aria-label="Pipeline progress"
    >
      <motion.div
        className="absolute bottom-0 left-0 h-[2px] bg-atlas-cyan"
        animate={{ width: `${progress * 100}%` }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      />
      {stages.map((stage, i) => {
        const done = activeIndex > i || current === "DONE";
        const active = activeIndex === i && current !== "DONE";
        return (
          <div key={stage} className="flex shrink-0 items-center">
            {i > 0 && <span className="mx-2 text-white/15">/</span>}
            <span
              className={`transition-colors duration-200 ${
                active
                  ? "font-medium text-atlas-cyan"
                  : done
                    ? "text-white/70"
                    : "text-white/30"
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
