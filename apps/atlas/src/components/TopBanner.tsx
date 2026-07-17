"use client";

interface TopBannerProps {
  clearance: "TRADER" | "DENIED";
  denial: string | null;
  running: boolean;
  onRun: () => void;
  mode: "live" | "replay";
  utc: string;
}

export function TopBanner({
  clearance,
  denial,
  running,
  onRun,
  mode,
  utc,
}: TopBannerProps) {
  const denied = clearance === "DENIED" || Boolean(denial);

  return (
    <header
      className={`flex h-12 shrink-0 items-center justify-between border-b px-4 transition-colors duration-150 ${
        denied
          ? "border-atlas-red bg-[#140a0a]"
          : "border-atlas-hairline bg-atlas-bg"
      }`}
    >
      <div className="flex items-center gap-4">
        <h1 className="font-mono text-[13px] font-semibold tracking-[0.12em] text-atlas-bright uppercase">
          Atlas Capital
        </h1>
        <span className="hidden font-mono text-[10px] tracking-[0.15em] text-atlas-muted uppercase sm:inline">
          Autonomous
        </span>
        <span
          className={`font-mono text-[10px] tracking-[0.15em] uppercase ${
            denied ? "text-atlas-red" : "text-atlas-cyan"
          }`}
        >
          Clearance: {denied ? "DENIED" : "TRADER"}
        </span>
        {denial && (
          <span className="fade-in hidden max-w-md truncate font-mono text-[10px] text-atlas-red md:inline">
            {denial}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <span className="hidden items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-atlas-muted uppercase sm:flex">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-atlas-green" />
          Live
        </span>
        <span className="hidden font-mono text-[10px] tabular text-atlas-dim md:inline">
          {utc}
        </span>
        <span className="font-mono text-[10px] tracking-[0.12em] text-atlas-amber uppercase">
          {mode === "replay" ? "Replay" : "Live"}
        </span>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className={`font-mono text-[11px] tracking-[0.18em] uppercase transition-colors duration-150 ${
            running
              ? "cursor-not-allowed text-atlas-dim"
              : "border border-atlas-cyan px-3 py-1.5 text-atlas-cyan hover:bg-atlas-cyan hover:text-atlas-bg"
          }`}
        >
          {running ? "Running…" : "Run Simulation"}
        </button>
      </div>
    </header>
  );
}
