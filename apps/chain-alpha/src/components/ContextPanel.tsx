"use client";

import { useState } from "react";
import type { FundState } from "@/lib/types";
import { ScenarioPanel } from "./ScenarioPanel";
import { AgentActivityPanel } from "./AgentActivityPanel";
import { ImpactPanel } from "./ImpactPanel";
import { TradingStrategyPanel } from "./TradingStrategyPanel";

type Tab = "scenario" | "agents" | "impact" | "trade";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "scenario", label: "Scenario" },
  { id: "agents", label: "Agents" },
  { id: "impact", label: "Impact" },
  { id: "trade", label: "Trade" },
];

interface ContextPanelProps {
  state: FundState;
  promptText: string;
  idle: boolean;
}

export function ContextPanel({ state, promptText, idle }: ContextPanelProps) {
  const [tab, setTab] = useState<Tab>("scenario");

  // Subtle activity dots so the operator knows where new data landed.
  const badge: Record<Tab, boolean> = {
    scenario: !!state.scenario,
    agents: state.tape.length > 0,
    impact: !!state.operational || !!state.financial,
    trade: state.proposals.length > 0,
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 border-b border-atlas-hairline">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex-1 border-r border-atlas-hairline/60 px-2 py-2 font-mono text-[10px] tracking-[0.12em] uppercase transition-colors last:border-r-0 ${
                active
                  ? "text-atlas-cyan"
                  : "text-atlas-muted hover:text-atlas-text"
              }`}
            >
              {t.label}
              {badge[t.id] && !active && (
                <span className="absolute right-1.5 top-1.5 h-1 w-1 rounded-full bg-atlas-cyan/70" />
              )}
              {active && (
                <span className="absolute inset-x-0 bottom-0 h-px bg-atlas-cyan" />
              )}
            </button>
          );
        })}
      </div>

      {tab === "scenario" && <ScenarioPanel state={state} promptText={promptText} />}
      {tab === "agents" && <AgentActivityPanel tape={state.tape} idle={idle} />}
      {tab === "impact" && <ImpactPanel state={state} />}
      {tab === "trade" && <TradingStrategyPanel state={state} />}
    </div>
  );
}
