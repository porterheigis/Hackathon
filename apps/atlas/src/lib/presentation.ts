import type { PipelineStage } from "./types";

export type Phase =
  | "idle"
  | "screening"
  | "awaiting_outcomes"
  | "simulating"
  | "playing"
  | "awaiting_approval"
  | "executing"
  | "done";

export type DisplayStageId =
  | "INGEST"
  | "MODEL"
  | "SIMULATE"
  | "RISK"
  | "EXECUTE"
  | "SETTLE";

export type DrawerTab =
  | "activity"
  | "fund"
  | "outcomes"
  | "proposals"
  | "systems";

export type PrimaryAction =
  | "focus-scenario"
  | "simulate"
  | "execute"
  | "new-scenario"
  | "none";

export interface DisplayStep {
  id: DisplayStageId;
  label: string;
}

export interface PresentationState {
  activeIndex: number;
  completed: boolean;
  displayStage: DisplayStageId | null;
  ctaLabel: string;
  ctaAction: PrimaryAction;
  ctaDisabled: boolean;
  requiredPanel: DrawerTab | null;
}

export const DISPLAY_STEPS: DisplayStep[] = [
  { id: "INGEST", label: "Ingest" },
  { id: "MODEL", label: "Model" },
  { id: "SIMULATE", label: "Simulate" },
  { id: "RISK", label: "Risk" },
  { id: "EXECUTE", label: "Execute" },
  { id: "SETTLE", label: "Settle" },
];

function stageFromPipeline(stage: PipelineStage): DisplayStageId | null {
  if (
    stage === "SCENARIO" ||
    stage === "SCREEN" ||
    stage === "AWAITING_OUTCOMES" ||
    stage === "INGEST"
  ) {
    return "INGEST";
  }
  if (stage === "MODEL") return "MODEL";
  if (
    stage === "SIMULATE" ||
    stage === "PROPOSE" ||
    stage === "AWAITING_APPROVAL"
  ) {
    return "SIMULATE";
  }
  if (stage === "RISK") return "RISK";
  if (stage === "EXECUTE") return "EXECUTE";
  if (stage === "SETTLE" || stage === "DONE") return "SETTLE";
  return null;
}

export function getPresentationState(input: {
  phase: Phase;
  stage: PipelineStage;
  selectedOutcomeCount: number;
  selectedProposalCount: number;
}): PresentationState {
  const { phase, stage, selectedOutcomeCount, selectedProposalCount } = input;
  const displayStage =
    phase === "playing" ? "SIMULATE" : stageFromPipeline(stage);
  const activeIndex = displayStage
    ? DISPLAY_STEPS.findIndex((step) => step.id === displayStage)
    : -1;

  if (phase === "idle") {
    return {
      activeIndex: -1,
      completed: false,
      displayStage: null,
      ctaLabel: "Define scenario",
      ctaAction: "focus-scenario",
      ctaDisabled: false,
      requiredPanel: null,
    };
  }

  if (phase === "screening") {
    return {
      activeIndex: 0,
      completed: false,
      displayStage: "INGEST",
      ctaLabel: "Screening event",
      ctaAction: "none",
      ctaDisabled: true,
      requiredPanel: null,
    };
  }

  if (phase === "awaiting_outcomes") {
    return {
      activeIndex: 0,
      completed: false,
      displayStage: "INGEST",
      ctaLabel: "Run simulation",
      ctaAction: "simulate",
      ctaDisabled: selectedOutcomeCount === 0,
      requiredPanel: "outcomes",
    };
  }

  if (phase === "simulating" || phase === "playing") {
    return {
      activeIndex: 2,
      completed: false,
      displayStage: "SIMULATE",
      ctaLabel: phase === "playing" ? "Simulation live" : "Building model",
      ctaAction: "none",
      ctaDisabled: true,
      requiredPanel: null,
    };
  }

  if (phase === "awaiting_approval") {
    return {
      activeIndex: 2,
      completed: false,
      displayStage: "SIMULATE",
      ctaLabel: "Execute selected",
      ctaAction: "execute",
      ctaDisabled: selectedProposalCount === 0,
      requiredPanel: "proposals",
    };
  }

  if (phase === "executing") {
    const executingStage = stageFromPipeline(stage) ?? "EXECUTE";
    return {
      activeIndex: DISPLAY_STEPS.findIndex((step) => step.id === executingStage),
      completed: false,
      displayStage: executingStage,
      ctaLabel: executingStage === "RISK" ? "Checking risk" : "Executing trades",
      ctaAction: "none",
      ctaDisabled: true,
      requiredPanel: null,
    };
  }

  return {
    activeIndex: DISPLAY_STEPS.length - 1,
    completed: true,
    displayStage: "SETTLE",
    ctaLabel: "New scenario",
    ctaAction: "new-scenario",
    ctaDisabled: false,
    requiredPanel: null,
  };
}
