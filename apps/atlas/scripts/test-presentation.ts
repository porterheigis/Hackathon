import assert from "node:assert/strict";
import { getPresentationState } from "../src/lib/presentation";

const idle = getPresentationState({
  phase: "idle",
  stage: "IDLE",
  selectedOutcomeCount: 0,
  selectedProposalCount: 0,
});
assert.equal(idle.activeIndex, -1);
assert.equal(idle.ctaAction, "focus-scenario");

const outcomes = getPresentationState({
  phase: "awaiting_outcomes",
  stage: "AWAITING_OUTCOMES",
  selectedOutcomeCount: 0,
  selectedProposalCount: 0,
});
assert.equal(outcomes.displayStage, "INGEST");
assert.equal(outcomes.requiredPanel, "outcomes");
assert.equal(outcomes.ctaDisabled, true);

const readyToSimulate = getPresentationState({
  phase: "awaiting_outcomes",
  stage: "AWAITING_OUTCOMES",
  selectedOutcomeCount: 2,
  selectedProposalCount: 0,
});
assert.equal(readyToSimulate.ctaDisabled, false);

const playback = getPresentationState({
  phase: "playing",
  stage: "DONE",
  selectedOutcomeCount: 2,
  selectedProposalCount: 2,
});
assert.equal(playback.displayStage, "SIMULATE");
assert.equal(playback.activeIndex, 2);

const approval = getPresentationState({
  phase: "awaiting_approval",
  stage: "AWAITING_APPROVAL",
  selectedOutcomeCount: 2,
  selectedProposalCount: 1,
});
assert.equal(approval.ctaAction, "execute");
assert.equal(approval.requiredPanel, "proposals");

const risk = getPresentationState({
  phase: "executing",
  stage: "RISK",
  selectedOutcomeCount: 2,
  selectedProposalCount: 1,
});
assert.equal(risk.displayStage, "RISK");

const done = getPresentationState({
  phase: "done",
  stage: "DONE",
  selectedOutcomeCount: 2,
  selectedProposalCount: 1,
});
assert.equal(done.completed, true);
assert.equal(done.ctaAction, "new-scenario");

console.log("presentation mapping: ok");
