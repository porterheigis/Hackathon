"use client";

import { useEffect, useRef } from "react";
import type { TapeLine } from "@/lib/sse";

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function DenyLine({ line }: { line: TapeLine }) {
  const p = (line.payload ?? {}) as {
    reason?: string;
    max_stake_usd?: number;
    attempted_usd?: number;
    gate?: string;
  };
  return (
    <div className="fade-in my-1 border border-v-red bg-v-red/10 px-3 py-2">
      <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-v-red">
        ⛔ access denied — {p.reason ?? "policy_denied"}
      </div>
      <div className="tabular mt-0.5 text-[11px] text-v-red/80">
        attempted ${p.attempted_usd?.toFixed(2)} · cap ${p.max_stake_usd?.toFixed(2)} · gate{" "}
        {p.gate}
      </div>
    </div>
  );
}

function Line({ line, isLast, running }: { line: TapeLine; isLast: boolean; running: boolean }) {
  const cursor = isLast && running ? " tape-cursor" : "";
  switch (line.kind) {
    case "thinking":
      return (
        <div className={`whitespace-pre-wrap py-0.5 text-[11px] italic leading-snug text-v-muted${cursor}`}>
          {line.text}
        </div>
      );
    case "say":
      return (
        <div className={`whitespace-pre-wrap py-0.5 text-xs leading-snug text-v-bright${cursor}`}>
          {line.text}
        </div>
      );
    case "tool_call":
      return (
        <div className="fade-in py-0.5 text-[11px] text-v-amber">
          ▸ {line.tool}({truncate(line.text ?? "", 160)})
        </div>
      );
    case "tool_result":
      return (
        <div className="fade-in py-0.5 text-[11px] text-v-green/80">
          ✓ {line.tool} → {truncate(line.text ?? "", 200)}
        </div>
      );
    case "deny":
      return <DenyLine line={line} />;
    case "error":
      return (
        <div className="fade-in py-0.5 text-[11px] text-v-red">
          ✗ {line.tool ? `${line.tool} → ` : ""}
          {truncate(line.text ?? "", 200)}
        </div>
      );
    case "system":
      return (
        <div className="py-1 text-[10px] uppercase tracking-[0.2em] text-v-dim">
          ── {line.text}
        </div>
      );
  }
}

export function ReasoningTape({ lines, running }: { lines: TapeLine[]; running: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [lines]);

  return (
    <section className="flex min-h-0 flex-col bg-v-bg">
      <div className="border-b border-v-hairline px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-v-muted">
        reasoning tape · streamed live from the model — nothing scripted
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {lines.length === 0 && (
          <div className="text-xs text-v-dim">
            idle. hit RUN AGENT — the desk reads today&apos;s wire, picks a story, and trades
            it under a live risk gate. every run is different.
          </div>
        )}
        {lines.map((line, i) => (
          <Line key={line.id} line={line} isLast={i === lines.length - 1} running={running} />
        ))}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
