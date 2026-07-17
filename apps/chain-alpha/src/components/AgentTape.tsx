"use client";

import { useEffect, useRef } from "react";
import type { TapeEvent } from "@/lib/types";

interface AgentTapeProps {
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

export function AgentTape({ tape, idle }: AgentTapeProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [tape.length]);

  if (idle && tape.length === 0) {
    return (
      <div className="flex flex-1 flex-col justify-center px-3 py-6">
        <p className="font-mono text-[10px] tracking-[0.15em] text-atlas-dim uppercase">
          Tape empty
        </p>
        <p className="mt-2 font-sans text-xs text-atlas-dim">
          Mandate not issued. Agent loop idle.
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
            className={`fade-in border-b border-atlas-hairline/60 px-1 py-1.5 font-mono text-[11px] leading-snug ${
              isLast ? "tape-cursor" : ""
            }`}
            title={JSON.stringify(row.meta ?? {}, null, 2)}
          >
            <div className="flex gap-2 text-atlas-dim">
              <span className="tabular shrink-0">{time}</span>
              <span className="w-14 shrink-0 uppercase tracking-wider">
                {row.kind}
              </span>
              <span className="w-16 shrink-0 text-atlas-muted">{row.stage}</span>
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
