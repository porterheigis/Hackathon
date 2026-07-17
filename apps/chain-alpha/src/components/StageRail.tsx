"use client";

import type { PipelineStage } from "@/lib/types";

interface StageRailProps {
  stages: PipelineStage[];
  activeIndex: number;
  current: PipelineStage;
}

export function StageRail({ stages, activeIndex, current }: StageRailProps) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-atlas-hairline px-4 font-mono text-[10px] tracking-[0.15em] uppercase">
      {stages.map((stage, i) => {
        const done = activeIndex > i || current === "DONE";
        const active = activeIndex === i && current !== "DONE";
        return (
          <div key={stage} className="flex items-center gap-1">
            {i > 0 && (
              <span className="mx-1 text-atlas-dim" aria-hidden>
                →
              </span>
            )}
            <span
              className={`transition-colors duration-150 ${
                active
                  ? "text-atlas-cyan"
                  : done
                    ? "text-atlas-text"
                    : "text-atlas-dim"
              }`}
            >
              {active && <span className="mr-1 text-atlas-cyan">●</span>}
              {stage}
            </span>
          </div>
        );
      })}
    </div>
  );
}
