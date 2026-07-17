"use client";

interface TopBannerProps {
  clearance: "TRADER" | "DENIED";
  denial: string | null;
  utc: string;
  mode: "live" | "replay";
  stageLabel?: string;
  error?: string | null;
  onDismissError?: () => void;
}

export function TopBanner({
  clearance,
  denial,
  utc,
  mode,
  stageLabel,
  error,
  onDismissError,
}: TopBannerProps) {
  const denied = clearance === "DENIED" || Boolean(denial);
  const hasError = Boolean(error);

  return (
    <header
      className={`flex h-12 shrink-0 items-center justify-between border-b px-4 transition-colors duration-200 ${
        hasError
          ? "border-atlas-red/50 bg-atlas-red/10"
          : denied
            ? "border-atlas-red/40 bg-atlas-red/5"
            : "border-white/[0.08] bg-atlas-bg/80 backdrop-blur-md"
      }`}
    >
      <div className="flex min-w-0 items-center gap-4">
        <h1 className="shrink-0 text-[14px] font-semibold tracking-tight text-white">
          Atlas Capital
        </h1>
        <span className="hidden text-[12px] text-white/30 sm:inline">
          Autonomous fund
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            denied || hasError
              ? "bg-atlas-red/15 text-atlas-red"
              : "bg-atlas-accent/15 text-atlas-accent"
          }`}
        >
          {hasError ? "Error" : denied ? "Clearance denied" : "Trader"}
        </span>
        {hasError ? (
          <span className="flex min-w-0 items-center gap-2 text-[11px] text-atlas-red">
            <span className="truncate">{error}</span>
            {onDismissError && (
              <button
                type="button"
                onClick={onDismissError}
                className="shrink-0 rounded px-1.5 py-0.5 text-white/50 hover:bg-white/10 hover:text-white"
              >
                Dismiss
              </button>
            )}
          </span>
        ) : (
          denial && (
            <span className="hidden max-w-md truncate text-[11px] text-atlas-red md:inline">
              {denial}
            </span>
          )
        )}
      </div>

      <div className="flex shrink-0 items-center gap-4 text-[11px] text-white/40">
        <span className="hidden items-center gap-1.5 sm:flex">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-atlas-green" />
          Live
        </span>
        <span className="hidden font-mono tabular md:inline">{utc}</span>
        <span className="rounded-full bg-white/[0.04] px-2 py-0.5 capitalize">
          {mode}
        </span>
        {stageLabel && (
          <span className="hidden text-white/55 lg:inline">{stageLabel}</span>
        )}
      </div>
    </header>
  );
}
