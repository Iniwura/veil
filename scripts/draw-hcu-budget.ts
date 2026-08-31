export const ZAMA_HCU_LIMITS = {
  transaction: 20_000_000,
  depth: 5_000_000,
} as const;

// Source: Zama FHEVM HCU guide.
// https://github.com/zama-ai/fhevm/blob/main/docs/solidity-guides/hcu.md
export const DRAW_HCU_COSTS = {
  randEuint64: 24_000,
  cast: 32,
  trivialEncrypt: 32,
  mulEuint128NonScalar: 1_686_000,
  shrEuint128Scalar: 37_000,
  addEuint64NonScalar: 162_000,
  ltEuint64NonScalar: 146_000,
  notEbool: 2,
  andEboolNonScalar: 25_000,
  selectEaddress: 83_000,
  orEboolNonScalar: 24_000,
} as const;

export const V3_MAX_PLAYERS = 24;

export type BlindDrawHcuEstimate = {
  participants: number;
  transactionHcu: number;
  depthHcu: number;
  transactionHeadroom: number;
  depthHeadroom: number;
  withinTransactionLimit: boolean;
  withinDepthLimit: boolean;
};

function requireParticipantCount(participants: number): void {
  if (!Number.isSafeInteger(participants) || participants < 1 || participants > 255) {
    throw new Error("participants must be an integer between 1 and 255");
  }
}

export function estimateBlindDrawHcu(participants: number): BlindDrawHcuEstimate {
  requireParticipantCount(participants);

  const costs = DRAW_HCU_COSTS;
  const random64Depth = costs.randEuint64;
  const random128Depth = random64Depth + costs.cast;
  const totalWeight128Depth = costs.cast;
  const productDepth = Math.max(random128Depth, totalWeight128Depth) + costs.mulEuint128NonScalar;
  const shiftedDepth = productDepth + costs.shrEuint128Scalar;
  const targetDepth = shiftedDepth + costs.cast;

  let cumulativeDepth = costs.trivialEncrypt;
  let winnerDepth = costs.trivialEncrypt;
  let selectedDepth = costs.trivialEncrypt;

  let transactionHcu =
    costs.randEuint64 +
    costs.cast +
    costs.cast +
    costs.mulEuint128NonScalar +
    costs.shrEuint128Scalar +
    costs.cast +
    costs.trivialEncrypt * 3;

  for (let index = 0; index < participants; index += 1) {
    cumulativeDepth += costs.addEuint64NonScalar;
    const crossesTargetDepth = Math.max(targetDepth, cumulativeDepth) + costs.ltEuint64NonScalar;
    const notSelectedDepth = selectedDepth + costs.notEbool;
    const chooseThisPlayerDepth = Math.max(crossesTargetDepth, notSelectedDepth) + costs.andEboolNonScalar;

    winnerDepth = Math.max(winnerDepth, chooseThisPlayerDepth) + costs.selectEaddress;
    selectedDepth = Math.max(selectedDepth, crossesTargetDepth) + costs.orEboolNonScalar;

    transactionHcu +=
      costs.addEuint64NonScalar +
      costs.ltEuint64NonScalar +
      costs.notEbool +
      costs.andEboolNonScalar +
      costs.selectEaddress +
      costs.orEboolNonScalar +
      costs.trivialEncrypt;
  }

  const depthHcu = Math.max(targetDepth, cumulativeDepth, winnerDepth, selectedDepth);
  return {
    participants,
    transactionHcu,
    depthHcu,
    transactionHeadroom: ZAMA_HCU_LIMITS.transaction - transactionHcu,
    depthHeadroom: ZAMA_HCU_LIMITS.depth - depthHcu,
    withinTransactionLimit: transactionHcu <= ZAMA_HCU_LIMITS.transaction,
    withinDepthLimit: depthHcu <= ZAMA_HCU_LIMITS.depth,
  };
}

export function maximumParticipantsWithinPublishedDepthLimit(): number {
  let maximum = 0;
  for (let participants = 1; participants <= 255; participants += 1) {
    if (!estimateBlindDrawHcu(participants).withinDepthLimit) break;
    maximum = participants;
  }
  return maximum;
}
