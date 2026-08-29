export const DRAW_ACTION_KINDS = [
  "WAIT",
  "SNAPSHOT",
  "SKIP",
  "BLIND_DRAW",
  "FINALIZE_WINNER",
  "PROCESS_PRIZE",
  "BEGIN_SNAPSHOT",
  "SNAPSHOT_SHARD",
  "COMPLETE_SNAPSHOT",
  "DRAW_SHARD",
  "FINALIZE_SHARD",
  "DRAW_MEMBER",
  "FINALIZE_MEMBER",
  "FUND_PRIZE",
  "DELIVER_PRIZE",
  "ADVANCE_NO_PRIZE",
  "BLOCKED",
] as const;

export type DrawActionKind = (typeof DRAW_ACTION_KINDS)[number];

export type DrawLifecycleStage = "SNAPSHOT" | "BLIND_DRAW" | "VERIFY" | "DELIVER" | "COMPLETE" | "WAIT" | "BLOCKED";

export type DrawAdvanceSchedule = {
  currentRoundId: bigint;
  ready: boolean;
  timeReady: boolean;
  insufficientParticipants: boolean;
};

export type DrawAction = {
  kind: DrawActionKind;
  roundId: bigint;
  title: string;
  description: string;
  actionable: boolean;
  stage: DrawLifecycleStage;
  shardIndex?: number;
  prizeIndex?: number;
};

function action(
  kind: DrawActionKind,
  roundId: bigint,
  title: string,
  description: string,
  actionable: boolean,
  stage: DrawLifecycleStage,
): DrawAction {
  return { kind, roundId, title, description, actionable, stage };
}

export function deriveNextDrawAction(
  schedule: DrawAdvanceSchedule,
  nextPrizeRoundId: bigint,
  behindState?: number,
): DrawAction {
  if (nextPrizeRoundId < schedule.currentRoundId) {
    switch (behindState) {
      case 1:
        return action(
          "BLIND_DRAW",
          nextPrizeRoundId,
          "RUN BLIND DRAW",
          "Run weighted selection over the immutable encrypted snapshot.",
          true,
          "BLIND_DRAW",
        );
      case 2:
        return action(
          "FINALIZE_WINNER",
          nextPrizeRoundId,
          "VERIFY WINNER",
          "Validate only the encrypted winner output with Zama/KMS proof.",
          true,
          "VERIFY",
        );
      case 3:
        return action(
          "PROCESS_PRIZE",
          nextPrizeRoundId,
          "DELIVER CONFIDENTIAL PRIZE",
          "Deliver the currently safe confidential strategy-share surplus directly to the finalized winner.",
          true,
          "DELIVER",
        );
      case 4:
      case 5:
        return action(
          "PROCESS_PRIZE",
          nextPrizeRoundId,
          "COMPLETE ROUND",
          "No prize is due. Advance the public prize-processing pointer to the next protocol round.",
          true,
          "COMPLETE",
        );
      default:
        return action(
          "BLOCKED",
          nextPrizeRoundId,
          "PROTOCOL STATE NEEDS REVIEW",
          "The public lifecycle pointers are inconsistent. No recovery transaction is available.",
          false,
          "BLOCKED",
        );
    }
  }

  if (nextPrizeRoundId > schedule.currentRoundId) {
    return action(
      "BLOCKED",
      nextPrizeRoundId,
      "PROTOCOL STATE NEEDS REVIEW",
      "The public prize pointer is ahead of the scheduled draw. No recovery transaction is available.",
      false,
      "BLOCKED",
    );
  }

  if (schedule.insufficientParticipants) {
    return action(
      "SKIP",
      schedule.currentRoundId,
      "MARK ROUND SKIPPED",
      "Fewer than two eligible seats existed at the scheduled close. No BlindDraw or encrypted winner will be created.",
      true,
      "SNAPSHOT",
    );
  }

  if (schedule.ready) {
    return action(
      "SNAPSHOT",
      schedule.currentRoundId,
      "SNAPSHOT ROUND",
      "Freeze the eligible encrypted weights for this scheduled round.",
      true,
      "SNAPSHOT",
    );
  }

  if (!schedule.timeReady) {
    return action(
      "WAIT",
      schedule.currentRoundId,
      "WAITING FOR SCHEDULED CLOSE",
      "The current draw remains open until its scheduled close.",
      false,
      "WAIT",
    );
  }

  return action(
    "BLOCKED",
    schedule.currentRoundId,
    "PROTOCOL STATE NEEDS REVIEW",
    "The draw is closed but its public readiness state is inconsistent. No recovery transaction is available.",
    false,
    "BLOCKED",
  );
}

export function sameDrawAction(left: DrawAction, right: DrawAction) {
  return (
    left.kind === right.kind &&
    left.roundId === right.roundId &&
    left.shardIndex === right.shardIndex &&
    left.prizeIndex === right.prizeIndex
  );
}
