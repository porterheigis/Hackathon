"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatSimClock, phaseAt, simDayAt } from "./timeline";
import type { SimTimeline, TimelinePhase } from "./types";

export interface PlaybackState {
  t: number;
  phase: TimelinePhase | null;
  simDay: number;
  clockLabel: string;
  done: boolean;
  playing: boolean;
  progress: number;
}

export interface UsePlaybackResult extends PlaybackState {
  skip: () => void;
  start: () => void;
  reset: () => void;
}

const UI_MS = 50; // ~20fps React updates

export function usePlayback(
  timeline: SimTimeline | null | undefined,
  opts?: { autoStart?: boolean; onDone?: () => void }
): UsePlaybackResult {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);

  const tRef = useRef(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastUiRef = useRef(0);
  const playingRef = useRef(false);
  const finishedRef = useRef(false);
  const onDoneRef = useRef(opts?.onDone);
  const timelineRef = useRef(timeline);
  const autoStartRef = useRef(opts?.autoStart);
  const startedKeyRef = useRef<string | null>(null);

  onDoneRef.current = opts?.onDone;
  timelineRef.current = timeline;
  autoStartRef.current = opts?.autoStart;

  const stopRaf = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    playingRef.current = false;
    stopRaf();
    tRef.current = 1;
    setT(1);
    setPlaying(false);
    setDone(true);
    // Defer parent callback so we don't nest setStates in the same flush
    queueMicrotask(() => onDoneRef.current?.());
  }, []);

  const tick = useCallback((now: number) => {
    const tl = timelineRef.current;
    if (!tl || !playingRef.current) return;

    if (startRef.current == null) startRef.current = now;
    const elapsed = now - startRef.current;
    const next = Math.min(1, elapsed / Math.max(1, tl.duration_ms));
    tRef.current = next;

    if (now - lastUiRef.current >= UI_MS || next >= 1) {
      lastUiRef.current = now;
      setT((prev) => (Math.abs(prev - next) < 0.0005 ? prev : next));
    }

    if (next >= 1) {
      finish();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [finish]);

  const start = useCallback(() => {
    if (!timelineRef.current) return;
    stopRaf();
    finishedRef.current = false;
    playingRef.current = true;
    startRef.current = null;
    lastUiRef.current = 0;
    tRef.current = 0;
    setT(0);
    setDone(false);
    setPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const skip = useCallback(() => {
    finish();
  }, [finish]);

  const reset = useCallback(() => {
    stopRaf();
    finishedRef.current = false;
    playingRef.current = false;
    startRef.current = null;
    startedKeyRef.current = null;
    tRef.current = 0;
    setT(0);
    setPlaying(false);
    setDone(false);
  }, []);

  // Auto-start when timeline identity/key changes — deps are primitives only
  const timelineKey = timeline
    ? `${timeline.epicenter}:${timeline.duration_ms}:${timeline.assets.length}`
    : null;

  useEffect(() => {
    if (!autoStartRef.current || !timelineKey || !timelineRef.current) {
      if (!timelineKey) startedKeyRef.current = null;
      return;
    }
    if (startedKeyRef.current === timelineKey && playingRef.current) return;
    startedKeyRef.current = timelineKey;
    start();
    return () => {
      stopRaf();
      playingRef.current = false;
      // Let React Strict Mode remount restart cleanly
      if (startedKeyRef.current === timelineKey) {
        startedKeyRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key drives restarts; start uses refs
  }, [timelineKey]);

  const phase = timeline ? phaseAt(timeline, t) : null;
  const simDay = timeline ? simDayAt(timeline, t) : 0;

  return {
    t,
    phase,
    simDay,
    clockLabel: timeline ? formatSimClock(simDay) : "T+0d 00:00",
    done,
    playing,
    progress: t,
    skip,
    start,
    reset,
  };
}
