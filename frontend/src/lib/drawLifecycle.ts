import type { DrawAction, DrawLifecycleStage } from "./drawAdvance";

const LIFECYCLE_STEPS = [
  ["OPEN", "Accepting positions"],
  ["SNAPSHOT", "Freeze encrypted weights"],
  ["BLIND DRAW", "Select privately"],
  ["VERIFY", "Validate KMS proof"],
  ["DELIVER", "Send the prize"],
] as const;

const ACTIVE_INDEX_BY_STAGE: Partial<Record<DrawLifecycleStage, number>> = {
  WAIT: 0,
  SNAPSHOT: 1,
  BLIND_DRAW: 2,
  VERIFY: 3,
  DELIVER: 4,
};

const ALL_FUTURE_STATES = ["future", "future", "future", "future", "future"] as const;

export type DrawLifecycleTerminalState = "SKIPPED" | "CANCELLED" | "COMPLETE";
export type DrawLifecycleStepState = "complete" | "active" | "future" | "inactive";

export type DrawLifecycleBranch = {
  kind: "READY_TO_SKIP" | "SKIPPED" | "CANCELLED" | "COMPLETE" | "BLOCKED";
  title: string;
  detail: string;
};

export type DrawLifecyclePresentation = {
  steps: ReadonlyArray<{
    id: (typeof LIFECYCLE_STEPS)[number][0];
    detail: (typeof LIFECYCLE_STEPS)[number][1];
    state: DrawLifecycleStepState;
  }>;
  branch?: DrawLifecycleBranch;
};

function stepsFromStates(states: ReadonlyArray<DrawLifecycleStepState>): DrawLifecyclePresentation["steps"] {
  return LIFECYCLE_STEPS.map(([id, detail], index) => ({ id, detail, state: states[index] ?? "future" }));
}

function stageStates(activeIndex: number): DrawLifecycleStepState[] {
  return LIFECYCLE_STEPS.map((_, index) =>
    index < activeIndex ? "complete" : index === activeIndex ? "active" : "future",
  );
}

function terminalPresentation(terminalState: DrawLifecycleTerminalState): DrawLifecyclePresentation {
  const states: DrawLifecycleStepState[] =
    terminalState === "SKIPPED"
      ? ["complete", "inactive", "inactive", "inactive", "inactive"]
      : terminalState === "COMPLETE"
        ? ["complete", "inactive", "inactive", "inactive", "inactive"]
        : ["complete", "complete", "complete", "complete", "inactive"];
  const branch =
    terminalState === "SKIPPED"
      ? {
          kind: "SKIPPED" as const,
          title: "SKIPPED",
          detail: "FEWER THAN TWO ELIGIBLE SEATS",
        }
      : terminalState === "CANCELLED"
        ? {
            kind: "CANCELLED" as const,
            title: "CANCELLED",
            detail: "ZERO-WEIGHT / ZERO-WINNER VERIFIED",
          }
        : {
            kind: "COMPLETE" as const,
            title: "COMPLETE",
            detail: "NO PRIZE DUE",
          };
  return { steps: stepsFromStates(states), branch };
}

export function deriveLifecyclePresentation(
  action?: DrawAction,
  terminalState?: DrawLifecycleTerminalState,
): DrawLifecyclePresentation {
  if (terminalState) return terminalPresentation(terminalState);

  if (action?.kind === "SKIP") {
    return {
      steps: stepsFromStates(["complete", "inactive", "inactive", "inactive", "inactive"]),
      branch: {
        kind: "READY_TO_SKIP",
        title: "READY TO SKIP",
        detail: "FEWER THAN TWO ELIGIBLE SEATS",
      },
    };
  }

  if (action?.kind === "BLOCKED") {
    return {
      steps: stepsFromStates(ALL_FUTURE_STATES),
      branch: {
        kind: "BLOCKED",
        title: "BLOCKED",
        detail: "PUBLIC STATE NEEDS REVIEW · NO LIFECYCLE PROGRESS INFERRED",
      },
    };
  }

  if (action?.stage === "COMPLETE") return terminalPresentation("COMPLETE");

  const activeIndex = action ? (ACTIVE_INDEX_BY_STAGE[action.stage] ?? 0) : 0;
  return { steps: stepsFromStates(stageStates(activeIndex)) };
}
