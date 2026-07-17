"use client";

const PHASES = [
  "Baseline",
  "Event",
  "Inventory Depletion",
  "Impact Peak",
  "Shortage",
  "Recovery",
  "Post-Assessment",
];

interface ScenarioTimelineProps {
  businessPhase: number;
  active: boolean;
}

export function ScenarioTimeline({ businessPhase, active }: ScenarioTimelineProps) {
  const current = active ? Math.max(0, Math.min(PHASES.length - 1, businessPhase)) : -1;

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-t border-atlas-hairline px-4">
      <span className="mr-2 font-mono text-[9px] tracking-[0.15em] text-atlas-dim uppercase">
        Business Effects
      </span>
      <div className="flex flex-1 items-center">
        {PHASES.map((phase, i) => {
          const isCurrent = i === current;
          const isPast = current >= 0 && i < current;
          return (
            <div key={phase} className="flex flex-1 items-center">
              <div className="flex items-center gap-1.5">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full transition-colors duration-200 ${
                    isCurrent
                      ? "bg-atlas-cyan"
                      : isPast
                        ? "bg-atlas-green/60"
                        : "bg-atlas-dim"
                  } ${isCurrent ? "ring-2 ring-atlas-cyan/30" : ""}`}
                />
                <span
                  className={`whitespace-nowrap font-mono text-[9px] tracking-[0.06em] uppercase transition-colors duration-200 ${
                    isCurrent
                      ? "text-atlas-cyan"
                      : isPast
                        ? "text-atlas-text"
                        : "text-atlas-dim"
                  }`}
                >
                  {phase}
                </span>
              </div>
              {i < PHASES.length - 1 && (
                <span
                  className={`mx-1.5 h-px flex-1 transition-colors duration-200 ${
                    isPast ? "bg-atlas-green/30" : "bg-atlas-hairline"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
