"use client";

import { motion } from "framer-motion";
import type { DisplayStep } from "@/lib/presentation";

interface StageRailProps {
  steps: DisplayStep[];
  activeIndex: number;
  completed?: boolean;
}

export function StageRail({ steps, activeIndex, completed }: StageRailProps) {
  return (
    <nav className="stage-rail" aria-label="Simulation progress">
      {steps.map((step, i) => {
        const done = completed || activeIndex > i;
        const active = activeIndex === i && !completed;
        return (
          <div className="stage-step" key={step.id} data-active={active} data-done={done}>
            {i > 0 && (
              <span className="stage-connector" aria-hidden="true">
                <motion.span
                  animate={{ scaleX: done || active ? 1 : 0 }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                />
              </span>
            )}
            <span className="stage-node" aria-current={active ? "step" : undefined}>
              {completed || done ? "✓" : i + 1}
            </span>
            <span className="stage-label">{step.label}</span>
          </div>
        );
      })}
    </nav>
  );
}
