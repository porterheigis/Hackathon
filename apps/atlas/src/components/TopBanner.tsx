"use client";

import { useEffect, useRef, useState } from "react";

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
  const [resizedNote, setResizedNote] = useState(false);
  const sawDeny = useRef(false);

  useEffect(() => {
    if (denied) {
      sawDeny.current = true;
      return;
    }
    if (sawDeny.current && clearance === "TRADER") {
      setResizedNote(true);
      const t = setTimeout(() => {
        setResizedNote(false);
        sawDeny.current = false;
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [denied, clearance]);

  return (
    <header
      className={`flex h-12 shrink-0 items-center justify-between border-b px-4 transition-colors duration-200 ${
        hasError
          ? "border-atlas-red/50 bg-atlas-red/10"
          : denied
            ? "border-atlas-red/40 bg-atlas-red/5"
            : "border-atlas-hairline bg-atlas-bg/80 backdrop-blur-md"
      }`}
    >
      <div className="flex min-w-0 items-center gap-4">
        <h1 className="shrink-0 text-[14px] font-semibold tracking-[0.04em] text-white">
          ATLAS CAPITAL
        </h1>
        <span className="hidden text-[12px] text-white/35 sm:inline">
          Autonomous fund
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            hasError || denied
              ? "bg-atlas-red/15 text-atlas-red"
              : resizedNote
                ? "bg-atlas-amber/15 text-atlas-amber"
                : "bg-atlas-cyan/15 text-atlas-cyan"
          }`}
        >
          {hasError
            ? "Error"
            : denied
              ? "Clearance denied"
              : resizedNote
                ? "Resized after deny"
                : "Trader"}
        </span>
        {hasError ? (
          <span className="flex min-w-0 items-center gap-2 text-[11px] text-atlas-red">
            <span className="truncate">{error}</span>
            {onDismissError && (
              <button
                type="button"
                onClick={onDismissError}
                className="shrink-0 rounded px-1.5 py-0.5 text-white/50 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-atlas-cyan"
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

      <div className="flex shrink-0 items-center gap-4 text-[11px] text-white/45">
        <span className="hidden items-center gap-1.5 sm:flex">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              mode === "replay" ? "bg-atlas-amber" : "bg-atlas-green"
            }`}
          />
          {mode === "replay" ? "Replay" : "Live"}
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
