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
  inputId?: string;
}

export function ScenarioInput({
  onSubmit,
  loading,
  disabled,
  inputId = "scenario-command",
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
      className="scenario-composer"
    >
      <div className="scenario-input-row">
        <input
          id={inputId}
          ref={inputRef}
          className="input-hero"
          aria-label="World event"
          placeholder="Describe a world event…"
          value={text}
          disabled={loading || disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button
          type="button"
          className="scenario-submit"
          disabled={loading || disabled || !text.trim()}
          onClick={submit}
        >
          {loading ? "Scanning…" : "Analyze"}
        </button>
      </div>
      <p className="scenario-hint">
        <span>⌘K to focus</span>
        <span>Or select a live scenario</span>
      </p>
      <div className="scenario-presets">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className="scenario-preset"
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
