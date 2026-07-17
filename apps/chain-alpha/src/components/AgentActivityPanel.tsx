"use client";

import { useEffect, useMemo, useRef } from "react";
import type { TapeEvent } from "@/lib/types";

interface AgentActivityPanelProps {
  tape: TapeEvent[];
  idle: boolean;
}

const KIND_COLOR: Record<TapeEvent["kind"], string> = {
  plan: "text-atlas-muted",
  act: "text-atlas-cyan",
  observe: "text-atlas-text",
  correct: "text-atlas-amber",
  system: "text-atlas-green",
};

/** Canonical agent order + accent color. */
const AGENT_META: Array<{ name: string; hex: string }> = [
  { name: "Scenario Interpreter", hex: "#39d3f5" },
  { name: "Supply Graph Agent", hex: "#39d3f5" },
  { name: "Logistics Agent", hex: "#ffb454" },
  { name: "Inventory Agent", hex: "#ffb454" },
  { name: "Substitution Agent", hex: "#2fd682" },
  { name: "Financial Agent", hex: "#39d3f5" },
  { name: "Risk Critic", hex: "#ff5c5c" },
  { name: "Simulation Orchestrator", hex: "#39d3f5" },
  { name: "Trading Agent", hex: "#2fd682" },
];

function agentHex(name: string): string {
  return AGENT_META.find((a) => a.name === name)?.hex ?? "#6b7785";
}

export function AgentActivityPanel({ tape, idle }: AgentActivityPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, TapeEvent[]>();
    for (const ev of tape) {
      const agent = ev.agent ?? "System";
      if (!map.has(agent)) {
        map.set(agent, []);
        order.push(agent);
      }
      map.get(agent)!.push(ev);
    }
    return order.map((agent) => ({ agent, events: map.get(agent)! }));
  }, [tape]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [tape.length]);

  if (idle && tape.length === 0) {
    return (
      <div className="flex flex-1 flex-col justify-center px-3 py-6">
        <p className="font-mono text-[10px] tracking-[0.15em] text-atlas-dim uppercase">
          Agents idle
        </p>
        <p className="mt-2 font-sans text-xs text-atlas-dim">
          Nine agents stand by: scenario interpretation, supply-graph, logistics,
          inventory, substitution, financial, risk, simulation, trading.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      {groups.map(({ agent, events }) => (
        <div key={agent} className="mb-2 last:mb-0">
          <div className="sticky top-0 z-[1] flex items-center gap-2 bg-atlas-bg/95 px-1 py-1">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: agentHex(agent) }}
            />
            <span className="font-mono text-[10px] tracking-[0.08em] text-atlas-bright uppercase">
              {agent}
            </span>
            <span className="ml-auto font-mono text-[9px] tabular text-atlas-dim">
              {events.length}
            </span>
          </div>
          {events.map((ev, i) => {
            const last = i === events.length - 1;
            return (
              <div
                key={ev.id}
                className={`fade-in border-l border-atlas-hairline/70 pl-2 ml-1.5 py-1 font-mono text-[11px] leading-snug ${
                  last ? "tape-cursor" : ""
                }`}
                title={JSON.stringify(ev.meta ?? {}, null, 2)}
              >
                <div className="flex gap-2 text-atlas-dim">
                  <span className="tabular shrink-0">{ev.ts.slice(11, 19)}</span>
                  <span className="shrink-0 uppercase tracking-wider">{ev.kind}</span>
                </div>
                <p className={`mt-0.5 ${KIND_COLOR[ev.kind]}`}>{ev.message}</p>
              </div>
            );
          })}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
