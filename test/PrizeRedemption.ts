import { expect } from "chai";
import { Interface } from "ethers";
import {
  derivePrizeRedemptionState,
  prizeRedemptionActionInvalidatesPrivateBalances,
  prizeRedemptionSubmissionBlocked,
  PRIZE_REDEMPTION_BATCH_STATES,
  selectLatestPrizeRedemptionState,
  ZERO_ENCRYPTED_HANDLE,
} from "../shared/prizeRedemptionLifecycle";
import {
  classifyPrizeRedemptionBatchActivity,
  decodePrizeRedemptionEvent,
  selectUniqueJoinedBatchId,
  type NormalizedPrizeRedemptionEvent,
} from "../shared/prizeRedemptionReceipts";

const HANDLE = `0x${"1".repeat(64)}`;

function state(overrides: Partial<Parameters<typeof derivePrizeRedemptionState>[0]> = {}) {
  return derivePrizeRedemptionState({
    batchId: 4n,
    batchState: PRIZE_REDEMPTION_BATCH_STATES.PENDING,
    currentBatchId: 4n,
    currentBatchOpenedAt: 100n,
    minimumBatchAge: 10n,
    now: 120n,
    depositedHandle: HANDLE,
    exchangeRate: 1n,
    account: "0x0000000000000000000000000000000000000001",
    ...overrides,
  });
}

describe("Prize redemption lifecycle", function () {
  it("shows a fresh pending batch as ready without a deposit", function () {
    expect(state({ depositedHandle: ZERO_ENCRYPTED_HANDLE }).status).to.equal("READY");
    expect(state({ depositedHandle: ZERO_ENCRYPTED_HANDLE }).action.actionable).to.equal(false);
  });

  it("waits for batch maturity before dispatch", function () {
    const next = state({ now: 105n });
    expect(next.status).to.equal("WAITING_FOR_BATCH");
    expect(next.action.actionable).to.equal(false);
  });

  it("offers dispatch once a joined batch is mature", function () {
    const next = state();
    expect(next.status).to.equal("JOINED");
    expect(next.action.kind).to.equal("DISPATCH");
  });

  it("offers aggregate proof after dispatch", function () {
    const next = state({ batchState: PRIZE_REDEMPTION_BATCH_STATES.DISPATCHED });
    expect(next.status).to.equal("DISPATCHED");
    expect(next.action.kind).to.equal("PROVE");
  });

  it("offers claim after finalized route and marks empty final batches complete", function () {
    expect(state({ batchState: PRIZE_REDEMPTION_BATCH_STATES.FINALIZED }).status).to.equal("CLAIMABLE");
    expect(
      state({ batchState: PRIZE_REDEMPTION_BATCH_STATES.FINALIZED, depositedHandle: ZERO_ENCRYPTED_HANDLE }).status,
    ).to.equal("COMPLETE");
  });

  it("offers refund after cancellation", function () {
    const next = state({ batchState: PRIZE_REDEMPTION_BATCH_STATES.CANCELED });
    expect(next.status).to.equal("CANCELED");
    expect(next.action.kind).to.equal("REFUND");
  });

  it("blocks stale pending batches and rejects unknown states", function () {
    expect(state({ currentBatchId: 5n }).status).to.equal("BLOCKED");
    expect(() => state({ batchState: 9 })).to.throw("UNVEIL_PRIZE_REDEMPTION_STATE_UNEXPECTED");
  });

  it("derives claimed and refunded completion from authoritative event status", function () {
    const claimed = state({
      batchState: PRIZE_REDEMPTION_BATCH_STATES.FINALIZED,
      depositStatus: "CLAIMED_COMPLETE",
    });
    const refunded = state({
      batchState: PRIZE_REDEMPTION_BATCH_STATES.CANCELED,
      depositStatus: "REFUNDED_COMPLETE",
    });
    expect(claimed.depositStatus).to.equal("CLAIMED_COMPLETE");
    expect(claimed.hasDeposit).to.equal(false);
    expect(claimed.action.actionable).to.equal(false);
    expect(refunded.depositStatus).to.equal("REFUNDED_COMPLETE");
    expect(refunded.hasDeposit).to.equal(false);
    expect(refunded.action.actionable).to.equal(false);
  });

  it("returns the actual Joined batch from a receipt even when preflight was stale", function () {
    const events: NormalizedPrizeRedemptionEvent[] = [
      {
        kind: "Joined",
        batchId: 5n,
        account: ALICE,
        emitter: BATCHER,
        transactionHash: TX,
      },
    ];
    expect(selectUniqueJoinedBatchId(events, ALICE, BATCHER, TX)).to.equal(5n);
  });

  it("parses the production Joined event directly from the submitted receipt", function () {
    const iface = new Interface(["event Joined(uint256 indexed batchId,address indexed account,bytes32 amount)"]);
    const encoded = iface.encodeEventLog("Joined", [6n, ALICE, HANDLE]);
    const event = decodePrizeRedemptionEvent(
      { address: BATCHER, topics: encoded.topics, data: encoded.data, transactionHash: TX },
      BATCHER,
    );
    expect(event?.batchId).to.equal(6n);
    expect(selectUniqueJoinedBatchId([event!], ALICE, BATCHER, TX)).to.equal(6n);
  });

  it("fails closed for missing, wrong-account, wrong-emitter, or ambiguous Joined logs", function () {
    const valid = {
      kind: "Joined" as const,
      batchId: 5n,
      account: ALICE,
      emitter: BATCHER,
      transactionHash: TX,
    };
    expect(() => selectUniqueJoinedBatchId([], ALICE, BATCHER, TX)).to.throw("BATCH_UNKNOWN");
    expect(() => selectUniqueJoinedBatchId([{ ...valid, account: BOB }], ALICE, BATCHER, TX)).to.throw("BATCH_UNKNOWN");
    expect(() => selectUniqueJoinedBatchId([{ ...valid, emitter: OTHER }], ALICE, BATCHER, TX)).to.throw(
      "BATCH_UNKNOWN",
    );
    expect(() => selectUniqueJoinedBatchId([valid, { ...valid, batchId: 6n }], ALICE, BATCHER, TX)).to.throw(
      "BATCH_UNKNOWN",
    );
  });

  it("classifies claimed, quit, and canceled-but-not-quit batches", function () {
    const joined: NormalizedPrizeRedemptionEvent = {
      kind: "Joined",
      batchId: 5n,
      account: ALICE,
      emitter: BATCHER,
    };
    expect(
      classifyPrizeRedemptionBatchActivity([joined, { ...joined, kind: "Claimed" }], ALICE, BATCHER, 5n).claimed,
    ).to.equal(true);
    expect(
      classifyPrizeRedemptionBatchActivity([joined, { ...joined, kind: "Quit" }], ALICE, BATCHER, 5n).quit,
    ).to.equal(true);
    expect(classifyPrizeRedemptionBatchActivity([joined], ALICE, BATCHER, 5n).quit).to.equal(false);
  });

  it("selects the newest active or claimable batch over completed history", function () {
    const completed = state({
      batchId: 8n,
      batchState: PRIZE_REDEMPTION_BATCH_STATES.FINALIZED,
      depositStatus: "CLAIMED_COMPLETE",
    });
    const active = state({
      batchId: 7n,
      batchState: PRIZE_REDEMPTION_BATCH_STATES.FINALIZED,
      depositStatus: "CLAIMABLE",
    });
    expect(selectLatestPrizeRedemptionState([completed, active])?.batchId).to.equal(7n);
    expect(selectLatestPrizeRedemptionState([completed])?.depositStatus).to.equal("CLAIMED_COMPLETE");
  });

  it("models reload discovery for active, claimable, claimed, refunded, and refundable batches", function () {
    expect(
      state({ batchState: PRIZE_REDEMPTION_BATCH_STATES.PENDING, depositStatus: "JOINED_ACTIVE" }).status,
    ).to.equal("JOINED");
    expect(state({ batchState: PRIZE_REDEMPTION_BATCH_STATES.FINALIZED, depositStatus: "CLAIMABLE" }).status).to.equal(
      "CLAIMABLE",
    );
    expect(
      state({ batchState: PRIZE_REDEMPTION_BATCH_STATES.FINALIZED, depositStatus: "CLAIMED_COMPLETE" }).status,
    ).to.equal("COMPLETE");
    expect(
      state({ batchState: PRIZE_REDEMPTION_BATCH_STATES.CANCELED, depositStatus: "REFUNDED_COMPLETE" }).status,
    ).to.equal("COMPLETE");
    expect(
      state({ batchState: PRIZE_REDEMPTION_BATCH_STATES.CANCELED, depositStatus: "REFUNDABLE" }).action.kind,
    ).to.equal("REFUND");
  });

  it("invalidates private balances for every balance-moving lifecycle action", function () {
    expect(prizeRedemptionActionInvalidatesPrivateBalances("DISPATCH")).to.equal(true);
    expect(prizeRedemptionActionInvalidatesPrivateBalances("PROVE")).to.equal(true);
    expect(prizeRedemptionActionInvalidatesPrivateBalances("CLAIM")).to.equal(true);
    expect(prizeRedemptionActionInvalidatesPrivateBalances("REFUND")).to.equal(true);
    expect(prizeRedemptionActionInvalidatesPrivateBalances("NONE")).to.equal(false);
  });

  it("blocks a second redemption while receipt recovery is unresolved", function () {
    expect(prizeRedemptionSubmissionBlocked({ transactionHash: TX, account: ALICE, message: "pending" })).to.equal(
      true,
    );
    expect(prizeRedemptionSubmissionBlocked(undefined)).to.equal(false);
  });
});

const ALICE = "0x0000000000000000000000000000000000000001";
const BOB = "0x0000000000000000000000000000000000000002";
const BATCHER = "0x00000000000000000000000000000000000000b1";
const OTHER = "0x00000000000000000000000000000000000000b2";
const TX = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
