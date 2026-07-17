import type { PipelineStage } from "./types";

const STAGES: PipelineStage[] = [
  "SCENARIO",
  "SCREEN",
  "MODEL",
  "SIMULATE",
  "PROPOSE",
  "RISK",
  "EXECUTE",
  "SETTLE",
];

export type UiPhase =
  | "idle"
  | "screening"
  | "awaiting_outcomes"
  | "simulating"
  | "playing"
  | "awaiting_approval"
  | "executing"
  | "done";

export function deriveDisplayStage(
  stage: PipelineStage,
  phase: UiPhase
): {
  activeIndex: number;
  railStage: PipelineStage;
  label: string | undefined;
} {
  if (phase === "playing") {
    return {
      activeIndex: STAGES.indexOf("SIMULATE"),
      railStage: "SIMULATE",
      label: "SIMULATE · PLAYBACK",
    };
  }

  let railStage: PipelineStage = stage;
  if (stage === "AWAITING_OUTCOMES") railStage = "SCREEN";
  else if (stage === "AWAITING_APPROVAL") railStage = "PROPOSE";
  else if (stage === "IDLE" || stage === "ERROR") railStage = "IDLE";

  let activeIndex = -1;
  if (stage === "DONE") activeIndex = STAGES.length;
  else if (stage !== "IDLE" && stage !== "ERROR") {
    activeIndex = STAGES.indexOf(railStage);
  }

  const label =
    stage !== "IDLE" && stage !== "ERROR"
      ? phase === "simulating"
        ? "SIMULATE"
        : stage
      : undefined;

  return { activeIndex, railStage, label };
}

export { STAGES as DISPLAY_STAGES };
