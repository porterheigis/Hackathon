"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

interface Preset {
  id: string;
  label: string;
  text: string;
}

interface ScenarioInputProps {
  onSubmit: (opts: { text?: string; preset_id?: string }) => void;
  loading?: boolean;
  disabled?: boolean;
}

export function ScenarioInput({
  onSubmit,
  loading,
  disabled,
}: ScenarioInputProps) {
  const [text, setText] = useState("");
  const [presets, setPresets] = useState<Preset[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/presets")
      .then((r) => r.json())
      .then((d: { presets: Preset[] }) => setPresets(d.presets ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = () => {
    if (loading || disabled) return;
    const t = text.trim();
    if (!t) return;
    onSubmit({ text: t });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-auto w-full max-w-xl px-4"
    >
      <p className="mb-3 text-center text-[15px] font-medium text-white/90">
        Describe a world event
      </p>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          className="input-hero"
          placeholder="e.g. The Strait of Hormuz closes…"
          value={text}
          disabled={loading || disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button
          type="button"
          className="btn-primary shrink-0 px-4 text-[13px]"
          disabled={loading || disabled || !text.trim()}
          onClick={submit}
        >
          {loading ? "Screening…" : "Screen"}
        </button>
      </div>
      <p className="mt-2 text-center text-[11px] text-white/30">
        ⌘K to focus · or try a preset
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className="pill px-3 py-1.5 text-[12px]"
            disabled={loading || disabled}
            onClick={() => onSubmit({ preset_id: p.id })}
            title={p.text}
          >
            {p.label}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
