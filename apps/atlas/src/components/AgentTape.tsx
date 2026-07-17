"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PipelineStage, TapeEvent, TapeKind } from "@/lib/types";

interface AgentTapeProps {
  tape: TapeEvent[];
  idle: boolean;
}

const KIND_LABEL: Record<TapeKind, string> = {
  plan: "PLAN",
  act: "ACT",
  observe: "OBS",
  correct: "CORR",
  system: "SYS",
};

const KIND_ACCENT: Record<TapeKind, string> = {
  plan: "bg-white/40",
  act: "bg-atlas-cyan",
  observe: "bg-white/60",
  correct: "bg-atlas-amber",
  system: "bg-white/35",
};

const KIND_TEXT: Record<TapeKind, string> = {
  plan: "text-white/55",
  act: "text-atlas-cyan",
  observe: "text-white/85",
  correct: "text-atlas-amber",
  system: "text-white/70",
};

const STAGE_GROUPS: PipelineStage[] = [
  "SCENARIO",
  "SCREEN",
  "AWAITING_OUTCOMES",
  "MODEL",
  "SIMULATE",
  "PROPOSE",
  "AWAITING_APPROVAL",
  "RISK",
  "EXECUTE",
  "SETTLE",
  "DONE",
  "ERROR",
  "IDLE",
  "INGEST",
];

function formatTapeTime(ts: string): string {
  try {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(11, 19);
    }
  } catch {
    /* */
  }
  return ts.slice(11, 19) || ts.slice(0, 8);
}

function detectActor(row: TapeEvent): string | null {
  const fromMeta = row.meta?.actor;
  if (typeof fromMeta === "string") return fromMeta;
  const m = row.message;
  if (/\bZero\b/i.test(m)) return "Zero";
  if (/\bNexla\b/i.test(m)) return "Nexla";
  if (/\bAkash\b/i.test(m)) return "Akash";
  if (/\bPomerium\b/i.test(m)) return "Pomerium";
  return null;
}

function isFillOrSettle(row: TapeEvent): boolean {
  return (
    /\bFILL\b/.test(row.message) ||
    row.stage === "SETTLE" ||
    /\bSettled\b/i.test(row.message)
  );
}

function isErrorRow(row: TapeEvent): boolean {
  return (
    row.stage === "ERROR" ||
    /\berror\b/i.test(row.message) ||
    /\bACCESS DENIED\b/.test(row.message)
  );
}

function stageTitle(stage: PipelineStage): string {
  return stage.replace(/_/g, " ");
}

export function AgentTape({ tape, idle }: AgentTapeProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const prevLen = useRef(0);

  const groups = useMemo(() => {
    const map = new Map<PipelineStage, TapeEvent[]>();
    for (const row of tape) {
      const list = map.get(row.stage) ?? [];
      list.push(row);
      map.set(row.stage, list);
    }
    return STAGE_GROUPS.filter((s) => map.has(s)).map((stage) => ({
      stage,
      rows: map.get(stage)!,
    }));
  }, [tape]);

  useEffect(() => {
    if (tape.length > prevLen.current && tape.length > 0) {
      setFlashId(tape[tape.length - 1].id);
      const t = setTimeout(() => setFlashId(null), 200);
      prevLen.current = tape.length;
      return () => clearTimeout(t);
    }
    prevLen.current = tape.length;
  }, [tape]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !stickRef.current) {
      if (!stickRef.current && tape.length) setShowJump(true);
      return;
    }
    el.scrollTop = el.scrollHeight;
    setShowJump(false);
  }, [tape.length, groups.length]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = dist < 48;
    setShowJump(!stickRef.current && tape.length > 0);
  };

  const jumpLatest = () => {
    stickRef.current = true;
    setShowJump(false);
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-2 scrollbar-atlas"
        aria-live="polite"
        aria-label="Agent activity log"
        role="log"
      >
        {idle && tape.length === 0 ? (
          <div className="flex h-full min-h-[120px] flex-col justify-center px-2 py-6">
            <p className="text-[12px] text-white/45">
              No activity yet — describe a world event to begin.
            </p>
          </div>
        ) : tape.length === 0 ? (
          <div className="px-2 py-4">
            <div className="h-3 w-2/3 rounded shimmer" />
            <div className="mt-2 h-3 w-1/2 rounded shimmer" />
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.stage} className="mb-2">
              <header className="sticky top-0 z-10 -mx-1 mb-1 border-b border-atlas-hairline bg-atlas-bg/95 px-1 py-1 backdrop-blur-sm">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/55">
                  {stageTitle(g.stage)}
                </p>
              </header>
              {g.rows.map((row) => {
                const actor = detectActor(row);
                const err = isErrorRow(row);
                const fill = isFillOrSettle(row);
                const hasMeta =
                  row.meta && Object.keys(row.meta).length > 0;
                const open = expanded === row.id;
                return (
                  <div
                    key={row.id}
                    className={`grid grid-cols-[auto_auto_1fr] gap-x-2 border-b border-white/[0.04] px-1 py-1.5 text-[11px] leading-snug transition-colors duration-150 ${
                      flashId === row.id ? "bg-white/[0.04]" : ""
                    } ${err ? "border-l-2 border-l-atlas-red pl-1.5" : ""}`}
                  >
                    <span className="font-mono tabular text-white/45">
                      {formatTapeTime(row.ts)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`inline-block h-2.5 w-[3px] rounded-full ${KIND_ACCENT[row.kind]}`}
                        aria-hidden
                      />
                      <span
                        className={`font-mono text-[10px] ${KIND_TEXT[row.kind]}`}
                      >
                        {KIND_LABEL[row.kind]}
                      </span>
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        {actor && (
                          <span className="rounded bg-white/[0.06] px-1 py-px font-mono text-[9px] uppercase tracking-wide text-white/50">
                            {actor}
                          </span>
                        )}
                        <p
                          className={`min-w-0 ${
                            err
                              ? "text-atlas-red"
                              : fill
                                ? "text-atlas-green"
                                : KIND_TEXT[row.kind]
                          }`}
                        >
                          {row.message}
                        </p>
                      </div>
                      {hasMeta && (
                        <button
                          type="button"
                          className="mt-0.5 text-[10px] text-white/40 hover:text-white/65 focus-visible:outline focus-visible:outline-1 focus-visible:outline-atlas-cyan"
                          onClick={() =>
                            setExpanded(open ? null : row.id)
                          }
                          aria-expanded={open}
                        >
                          {open ? "Hide detail" : "Detail"}
                        </button>
                      )}
                      {open && hasMeta && (
                        <pre className="mt-1 overflow-x-auto rounded border border-atlas-hairline bg-black/30 p-1.5 font-mono text-[10px] text-white/50">
                          {JSON.stringify(row.meta, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          ))
        )}
      </div>
      {showJump && (
        <button
          type="button"
          onClick={jumpLatest}
          className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full border border-atlas-hairline bg-atlas-bg/90 px-3 py-1 font-mono text-[10px] text-atlas-cyan shadow-lg backdrop-blur focus-visible:outline focus-visible:outline-1 focus-visible:outline-atlas-cyan"
        >
          Jump to latest
        </button>
      )}
    </div>
  );
}
