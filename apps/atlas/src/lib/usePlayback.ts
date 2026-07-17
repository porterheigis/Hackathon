"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatSimClock,
  phaseAt,
  simDayAt,
} from "./timeline";
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

export function usePlayback(
  timeline: SimTimeline | null | undefined,
  opts?: { autoStart?: boolean; onDone?: () => void }
): UsePlaybackResult {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const onDoneRef = useRef(opts?.onDone);
  onDoneRef.current = opts?.onDone;
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;

  const stopRaf = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const finish = useCallback(() => {
    stopRaf();
    setT(1);
    setPlaying(false);
    setDone(true);
    onDoneRef.current?.();
  }, []);

  const tick = useCallback((now: number) => {
    const tl = timelineRef.current;
    if (!tl) return;
    if (startRef.current == null) startRef.current = now;
    const elapsed = now - startRef.current;
    const next = Math.min(1, elapsed / tl.duration_ms);
    setT(next);
    if (next >= 1) {
      finish();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [finish]);

  const start = useCallback(() => {
    const tl = timelineRef.current;
    if (!tl) return;
    stopRaf();
    startRef.current = null;
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
    startRef.current = null;
    setT(0);
    setPlaying(false);
    setDone(false);
  }, []);

  useEffect(() => {
    if (opts?.autoStart && timeline) {
      start();
    }
    return () => stopRaf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline?.duration_ms, timeline?.epicenter, opts?.autoStart]);

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
