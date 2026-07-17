"use client";

import { useEffect, useRef, useState } from "react";

export const CURATED_SCENARIOS: Array<{ id: string; label: string }> = [
  { id: "taiwan-earthquake", label: "Taiwan Earthquake" },
  { id: "taiwan-strait-closure", label: "Taiwan Strait Closure" },
  { id: "red-sea", label: "Red Sea (legacy)" },
];

interface ScenarioComposerProps {
  prompt: string;
  onPromptChange: (v: string) => void;
  scenarioId: string;
  onScenarioChange: (id: string) => void;
  onRun: () => void;
  onReset: () => void;
  onInjectShock: () => void;
  running: boolean;
  canInjectShock: boolean;
}

// Minimal typing for the Web Speech API (not in lib.dom by default).
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

export function ScenarioComposer({
  prompt,
  onPromptChange,
  scenarioId,
  onScenarioChange,
  onRun,
  onReset,
  onInjectShock,
  running,
  canInjectShock,
}: ScenarioComposerProps) {
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseTextRef = useRef("");

  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    setSpeechSupported(!!Ctor);
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* noop */
      }
      recognitionRef.current = null;
    };
  }, []);

  const startDictation = () => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setSpeechSupported(false);
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    baseTextRef.current = prompt ? prompt.trimEnd() + " " : "";
    rec.onresult = (e) => {
      let transcript = "";
      for (let i = 0; i < e.results.length; i += 1) {
        transcript += e.results[i][0].transcript;
      }
      onPromptChange(baseTextRef.current + transcript);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  const stopDictation = () => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* noop */
    }
    setListening(false);
  };

  const toggleMic = () => {
    if (!speechSupported) return;
    if (listening) stopDictation();
    else startDictation();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!running) onRun();
    }
  };

  return (
    <div className="pointer-events-auto w-full max-w-2xl rounded-md border border-atlas-hairline bg-atlas-bg/85 p-2 backdrop-blur-sm">
      <div className="flex items-start gap-2">
        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder="Describe a disruption to the world model…"
          className="min-h-[3rem] flex-1 resize-none bg-transparent px-2 py-1 font-sans text-[13px] leading-snug text-atlas-bright placeholder:text-atlas-dim focus:outline-none"
        />
        <button
          type="button"
          onClick={toggleMic}
          disabled={!speechSupported}
          title={speechSupported ? (listening ? "Stop dictation" : "Dictate scenario") : "Speech recognition not supported"}
          aria-pressed={listening}
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border transition-colors ${
            !speechSupported
              ? "cursor-not-allowed border-atlas-hairline text-atlas-dim opacity-50"
              : listening
                ? "border-atlas-red/60 text-atlas-red animate-pulse"
                : "border-atlas-hairline text-atlas-muted hover:text-atlas-cyan"
          }`}
        >
          {/* microphone glyph */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
          </svg>
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <select
          value={scenarioId}
          onChange={(e) => onScenarioChange(e.target.value)}
          disabled={running}
          className="cursor-pointer rounded-sm border border-atlas-hairline bg-transparent px-2 py-1 font-mono text-[10px] tracking-[0.05em] text-atlas-text outline-none hover:border-atlas-dim focus:border-atlas-cyan disabled:opacity-50"
        >
          {CURATED_SCENARIOS.map((s) => (
            <option key={s.id} value={s.id} className="bg-atlas-bg text-atlas-text">
              {s.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={onInjectShock}
          disabled={!canInjectShock || running}
          title="Re-run the current scenario with the Japan export-restriction secondary shock"
          className="rounded-sm border border-atlas-amber/40 px-2 py-1 font-mono text-[10px] tracking-[0.08em] text-atlas-amber uppercase transition-colors hover:bg-atlas-amber/10 disabled:cursor-not-allowed disabled:border-atlas-hairline disabled:text-atlas-dim disabled:hover:bg-transparent"
        >
          Inject Japan Shock
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            disabled={running}
            className="rounded-sm border border-atlas-hairline px-3 py-1 font-mono text-[10px] tracking-[0.1em] text-atlas-muted uppercase transition-colors hover:text-atlas-text disabled:opacity-40"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className="rounded-sm border border-atlas-cyan/60 bg-atlas-cyan/10 px-4 py-1 font-mono text-[10px] font-semibold tracking-[0.15em] text-atlas-cyan uppercase transition-colors hover:bg-atlas-cyan/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "Running…" : "Run"}
          </button>
        </div>
      </div>

      {!speechSupported && (
        <p className="mt-1 px-2 font-mono text-[9px] text-atlas-dim">
          Voice dictation unavailable in this browser — type your scenario.
        </p>
      )}
    </div>
  );
}
