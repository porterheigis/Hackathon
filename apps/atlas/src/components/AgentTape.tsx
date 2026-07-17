"use client";

import { useEffect, useRef } from "react";
import type { TapeEvent } from "@/lib/types";

interface AgentTapeProps {
  tape: TapeEvent[];
  idle: boolean;
}

const KIND_COLOR: Record<TapeEvent["kind"], string> = {
  plan: "text-white/40",
  act: "text-atlas-accent",
  observe: "text-white/80",
  correct: "text-atlas-amber",
  system: "text-atlas-green",
};

export function AgentTape({ tape, idle }: AgentTapeProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [tape.length]);

  if (idle && tape.length === 0) {
    return (
      <div className="flex flex-1 flex-col justify-center px-3 py-6">
        <p className="text-[12px] text-white/30">
          No activity yet — describe a world event to begin.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      {tape.map((row, i) => {
        const isLast = i === tape.length - 1;
        const time = row.ts.slice(11, 19);
        return (
          <div
            key={row.id}
            className={`border-b border-white/[0.04] px-1 py-1.5 text-[11px] leading-snug ${
              isLast ? "bg-white/[0.02]" : ""
            }`}
            title={JSON.stringify(row.meta ?? {}, null, 2)}
          >
            <div className="flex gap-2 font-mono text-white/30">
              <span className="tabular shrink-0">{time}</span>
              <span className="w-14 shrink-0 capitalize">{row.kind}</span>
              <span className="w-20 shrink-0 truncate text-white/20">
                {row.stage}
              </span>
            </div>
            <p className={`mt-0.5 pl-[4.5rem] ${KIND_COLOR[row.kind]}`}>
              {row.message}
            </p>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
