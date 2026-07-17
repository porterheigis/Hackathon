"use client";

import type { FundState } from "@/lib/types";

interface Selector {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}

interface AppHeaderProps {
  industry: string;
  company: string;
  horizonWeeks: number;
  onIndustry: (v: string) => void;
  onCompany: (v: string) => void;
  onHorizon: (v: number) => void;
  mode: FundState["mode"];
  clearance: FundState["clearance"];
  running: boolean;
  utc: string;
  disabled?: boolean;
}

export const COMPANY_OPTIONS = [
  { value: "NVIDIA", label: "NVIDIA" },
  { value: "AMD", label: "AMD" },
  { value: "TSMC", label: "TSMC" },
  { value: "Intel", label: "Intel" },
  { value: "ASML", label: "ASML" },
];

const INDUSTRY_OPTIONS = [
  { value: "Semiconductors", label: "Semiconductors" },
];

const HORIZON_OPTIONS = [4, 8, 12, 16, 24].map((w) => ({
  value: String(w),
  label: `${w} weeks`,
}));

function FieldSelect({ label, value, options, onChange, disabled }: Selector & { disabled?: boolean }) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="font-mono text-[9px] tracking-[0.15em] text-atlas-dim uppercase">
        {label}
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer rounded-sm border border-atlas-hairline bg-transparent px-2 py-0.5 font-mono text-[11px] text-atlas-bright outline-none transition-colors hover:border-atlas-dim focus:border-atlas-cyan disabled:cursor-not-allowed disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-atlas-bg text-atlas-text">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AppHeader({
  industry,
  company,
  horizonWeeks,
  onIndustry,
  onCompany,
  onHorizon,
  mode,
  clearance,
  running,
  utc,
  disabled,
}: AppHeaderProps) {
  const denied = clearance === "DENIED";
  return (
    <header className="flex h-14 shrink-0 items-center gap-5 border-b border-atlas-hairline px-4">
      {/* Wordmark */}
      <div className="flex items-baseline gap-2.5">
        <span className="font-mono text-[15px] font-semibold tracking-[0.18em] text-atlas-bright">
          CHAIN<span className="text-atlas-cyan">ALPHA</span>
        </span>
        <span className="hidden font-sans text-[10px] text-atlas-dim lg:inline">
          From physical-world disruption to tradable financial exposure
        </span>
      </div>

      {/* Selectors */}
      <div className="ml-2 flex items-center gap-4">
        <FieldSelect
          label="Industry"
          value={industry}
          options={INDUSTRY_OPTIONS}
          onChange={onIndustry}
          disabled={disabled}
        />
        <FieldSelect
          label="Company"
          value={company}
          options={COMPANY_OPTIONS}
          onChange={onCompany}
          disabled={disabled}
        />
        <FieldSelect
          label="Horizon"
          value={String(horizonWeeks)}
          options={HORIZON_OPTIONS}
          onChange={(v) => onHorizon(Number(v))}
          disabled={disabled}
        />
      </div>

      {/* Status cluster */}
      <div className="ml-auto flex items-center gap-4 font-mono text-[10px] tracking-[0.12em] uppercase">
        <span
          className={`flex items-center gap-1.5 ${
            mode === "replay" ? "text-atlas-cyan" : "text-atlas-green"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              mode === "replay" ? "bg-atlas-cyan" : "bg-atlas-green"
            } ${running ? "animate-pulse" : ""}`}
          />
          {mode === "replay" ? "Replay" : "Live"}
        </span>

        <span className="rounded-sm border border-atlas-hairline px-1.5 py-0.5 text-atlas-muted">
          Paper Trading
        </span>

        <span
          className={`rounded-sm border px-1.5 py-0.5 ${
            denied
              ? "border-atlas-red/50 text-atlas-red"
              : "border-atlas-green/40 text-atlas-green"
          }`}
        >
          {clearance}
        </span>

        <span className="tabular text-atlas-muted">{utc || "— — —"}</span>

        <span
          className="h-2 w-2 rounded-full bg-atlas-green"
          title="System nominal · sponsors online"
        />
      </div>
    </header>
  );
}
