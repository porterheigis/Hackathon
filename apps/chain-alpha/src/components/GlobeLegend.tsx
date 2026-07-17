"use client";

type LegendItem = {
  label: string;
  hex: string;
  /** dot = observed asset marker, line = route/track */
  shape: "dot" | "line";
};

const ITEMS: LegendItem[] = [
  { label: "Observed live", hex: "#39d3f5", shape: "dot" },
  { label: "Observed replay", hex: "#5a7d9a", shape: "dot" },
  { label: "Exposed observed asset", hex: "#ffb454", shape: "dot" },
  { label: "Disrupted node / route", hex: "#ff5c5c", shape: "dot" },
  { label: "Simulated alternative route", hex: "#2fd682", shape: "line" },
];

export function GlobeLegend() {
  return (
    <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1 rounded-sm border border-atlas-hairline bg-atlas-bg/70 px-2.5 py-2 font-mono text-[10px] tracking-[0.08em] text-atlas-muted uppercase backdrop-blur-[2px]">
      <span className="mb-0.5 text-atlas-dim">Legend</span>
      {ITEMS.map((it) => (
        <div key={it.label} className="flex items-center gap-2">
          {it.shape === "dot" ? (
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: it.hex }}
            />
          ) : (
            <span
              className="h-0.5 w-3 shrink-0"
              style={{
                backgroundImage: `repeating-linear-gradient(90deg, ${it.hex} 0 3px, transparent 3px 5px)`,
              }}
            />
          )}
          <span className="text-atlas-text">{it.label}</span>
        </div>
      ))}
    </div>
  );
}
