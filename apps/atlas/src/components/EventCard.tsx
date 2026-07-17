"use client";

import { motion } from "framer-motion";
import type { FixtureEvent } from "@/lib/types";
import type { Phase } from "@/lib/presentation";
import { ScenarioInput } from "@/components/ScenarioInput";

interface EventCardProps {
  event: FixtureEvent | null;
  phase: Phase;
  onSubmit: (opts: { text?: string; preset_id?: string }) => void;
}

export function EventCard({ event, phase, onSubmit }: EventCardProps) {
  const composing = phase === "idle" || phase === "screening" || !event;

  return (
    <motion.section
      className="event-card hud-panel"
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      aria-label={composing ? "Scenario composer" : "Detected event"}
    >
      <span className="hud-corner hud-corner-tl" aria-hidden="true" />
      <span className="hud-corner hud-corner-br" aria-hidden="true" />
      {composing ? (
        <>
          <div className="event-card-heading">
            <div className={`radar-mark ${phase === "screening" ? "is-scanning" : ""}`}>
              <span />
            </div>
            <div>
              <p className="hud-kicker">
                {phase === "screening" ? "Signal acquisition" : "Scenario command"}
              </p>
              <h2>Model a market shock</h2>
              <p className="event-card-copy">
                Describe a disruption. Atlas will trace exposure, simulate impact, and propose trades.
              </p>
            </div>
          </div>
          <ScenarioInput onSubmit={onSubmit} loading={phase === "screening"} />
        </>
      ) : (
        <div className="detected-event">
          <div className="threat-glyph" aria-hidden="true">
            <span>!</span>
          </div>
          <div className="detected-event-copy">
            <p className="hud-kicker hud-kicker-amber">Event detected</p>
            <h2>{event.title}</h2>
            <p>{event.summary}</p>
            <div className="event-meta">
              <span>{event.source.replace("zero://", "ZERO / ")}</span>
              <span>{Math.round(event.implied_probability * 100)}% implied</span>
            </div>
          </div>
        </div>
      )}
    </motion.section>
  );
}
