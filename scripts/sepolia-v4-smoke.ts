import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { deployments, ethers, fhevm, network } from "hardhat";

import {
  MockUSDC,
  MockUSDCConfidentialWrapper,
  MockYieldVault4626,
  MockYieldVaultShareConfidentialWrapper,
  VeilDepositBatcher,
  VeilPoolV4,
  VeilPrizeVaultV3,
  VeilStrategyManagerV3,
  VeilWithdrawalBatcher,
} from "../types";
import { V4_DEPLOYMENT_NAMES } from "../deploy/deploy-v4";

const MAX_OPERATOR_UNTIL = 2n ** 48n - 1n;
const DEMO_DEPOSIT = 100n;
const SHARD_COUNT = 24;
const PRIZE_SLOTS = 3;
const MAX_ROUNDS_TO_MATURITY = 4;

const V4_ADDRESS_ENV = {
  asset: "UNVEIL_V4_MOCK_USDC_ADDRESS",
  principal: "UNVEIL_V4_PRINCIPAL_WRAPPER_ADDRESS",
  vault: "UNVEIL_V4_MOCK_YIELD_VAULT_ADDRESS",
  shares: "UNVEIL_V4_SHARE_WRAPPER_ADDRESS",
  depositBatcher: "UNVEIL_V4_DEPOSIT_BATCHER_ADDRESS",
  withdrawalBatcher: "UNVEIL_V4_WITHDRAWAL_BATCHER_ADDRESS",
  pool: "UNVEIL_V4_POOL_ADDRESS",
  prizeVault: "UNVEIL_V4_PRIZE_VAULT_ADDRESS",
  manager: "UNVEIL_V4_MANAGER_ADDRESS",
} as const;

type AddressKey = keyof typeof V4_ADDRESS_ENV;
type V4Addresses = Record<AddressKey, string>;

type System = {
  asset: MockUSDC;
  principal: MockUSDCConfidentialWrapper;
  vault: MockYieldVault4626;
  shares: MockYieldVaultShareConfidentialWrapper;
  deposits: VeilDepositBatcher;
  withdrawals: VeilWithdrawalBatcher;
  pool: VeilPoolV4;
  prizeVault: VeilPrizeVaultV3;
  manager: VeilStrategyManagerV3;
};

type PrizeResult = { shard: number; winner: string };

const drawStateNames = ["NONE", "SNAPSHOTTED", "DRAWN", "FINALIZED", "CANCELLED", "SKIPPED"];

function namedDrawState(state: number): string {
  return drawStateNames[state] ?? `UNKNOWN(${state})`;
}

function requireAddress(label: string, actual: string, expected: string): void {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`UNVEIL_V4 wiring mismatch: ${label} is ${actual}, expected ${expected}`);
  }
}

async function resolveAddress(key: AddressKey): Promise<string> {
  const envName = V4_ADDRESS_ENV[key];
  const configured = process.env[envName];
  if (configured !== undefined) {
    const value = configured.trim();
    if (!ethers.isAddress(value)) throw new Error(`${envName} is not a valid address`);
    return value;
  }

  try {
    return (await deployments.get(V4_DEPLOYMENT_NAMES[key])).address;
  } catch {
    throw new Error(
      `Missing ${V4_DEPLOYMENT_NAMES[key]}. Deploy the V4 stack first or provide ${envName}; no V2/V3 fallback is allowed.`,
    );
  }
}

async function latestTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  if (!block) throw new Error("Latest block unavailable");
  return block.timestamp;
}

async function waitForRealTime(label: string, target: number): Promise<boolean> {
  const current = await latestTimestamp();
  if (current >= target) return true;

  console.log(`  ${label} is not ready; target Unix timestamp: ${target}`);
  if (process.env.UNVEIL_V4_SMOKE_WAIT !== "true") {
    console.log("  Exiting cleanly. Set UNVEIL_V4_SMOKE_WAIT=true to poll Sepolia time and continue.");
    return false;
  }

  while (true) {
    const remaining = target - (await latestTimestamp());
    if (remaining <= 0) return true;
    console.log(`  waiting ${remaining}s for ${label}...`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, Math.max(1_000, remaining * 1_000))));
  }
}

async function ensureGas(deployer: HardhatEthersSigner, signer: HardhatEthersSigner): Promise<void> {
  const minimum = ethers.parseEther("0.005");
  const target = ethers.parseEther("0.01");
  const balance = await ethers.provider.getBalance(signer.address);
  if (balance >= minimum) return;

  const deployerBalance = await ethers.provider.getBalance(deployer.address);
  const topUp = target - balance;
  if (deployerBalance < topUp + minimum) {
    throw new Error(`Insufficient deployer ETH to fund ${signer.address} for the V4 smoke test`);
  }
  await (await deployer.sendTransaction({ to: signer.address, value: topUp })).wait();
}

async function decrypt64(contractAddress: string, handle: string, signer: HardhatEthersSigner): Promise<bigint> {
  if (handle === ethers.ZeroHash) return 0n;
  return fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddress, signer);
}

async function encryptedInput(contractAddress: string, signer: HardhatEthersSigner, amount: bigint) {
  return fhevm.createEncryptedInput(contractAddress, signer.address).add64(amount).encrypt();
}

async function ensureOperator(
  token: MockUSDCConfidentialWrapper,
  holder: HardhatEthersSigner,
  operator: string,
): Promise<void> {
  if (!(await token.isOperator(holder.address, operator))) {
    await (await token.connect(holder).setOperator(operator, MAX_OPERATOR_UNTIL)).wait();
  }
}

async function ensureDeposit(system: System, account: HardhatEthersSigner): Promise<void> {
  const poolAddress = await system.pool.getAddress();
  const principalAddress = await system.principal.getAddress();

  await ensureOperator(system.principal, account, poolAddress);

  if (!(await system.pool.joined(account.address))) {
    const currentPrincipal = await decrypt64(
      principalAddress,
      await system.principal.confidentialBalanceOf(account.address),
      account,
    );
    if (currentPrincipal > DEMO_DEPOSIT) {
      throw new Error(`${account.address} has more than the expected V4 demo principal`);
    }

    const needed = DEMO_DEPOSIT - currentPrincipal;
    if (needed > 0n) {
      const underlyingBalance = await system.asset.balanceOf(account.address);
      if (underlyingBalance < needed) {
        await (await system.asset.mint(account.address, needed - underlyingBalance)).wait();
      }
      await (await system.asset.connect(account).approve(principalAddress, needed)).wait();
      await (await system.principal.connect(account).wrap(account.address, needed)).wait();
    }

    const input = await encryptedInput(poolAddress, account, DEMO_DEPOSIT);
    await (await system.pool.connect(account).deposit(input.handles[0], input.inputProof)).wait();
  }

  const active = await decrypt64(poolAddress, await system.pool.connect(account).encryptedBalanceOf(), account);
  const reserved = await decrypt64(
    poolAddress,
    await system.pool.connect(account).encryptedReservedWithdrawalOf(),
    account,
  );
  if (active !== DEMO_DEPOSIT || reserved !== 0n) {
    throw new Error(`${account.address} is not in the expected active 100 / reserved 0 V4 smoke position`);
  }
}

async function snapshotRound(pool: VeilPoolV4, roundId: bigint, caller: HardhatEthersSigner): Promise<boolean> {
  let state = Number(await pool.getDrawState(roundId));

  if (state === 0) {
    const currentRoundId = await pool.nextRoundId();
    if (currentRoundId !== roundId) {
      throw new Error(`Round ${roundId} is NONE but pool.nextRoundId is ${currentRoundId}`);
    }
    const closesAt = Number(await pool.nextDrawClosesAt());
    if (!(await waitForRealTime(`draw ${roundId}`, closesAt))) return false;
    await (await pool.connect(caller).beginSnapshotRound()).wait();
    state = Number(await pool.getDrawState(roundId));
  }

  if (state !== 1) return true;

  let snapshot = await pool.getShardedSnapshotRound(roundId);
  if (!snapshot[5]) {
    for (let shard = 0; shard < SHARD_COUNT; shard++) {
      const shardStatus = await pool.getSnapshotShard(roundId, shard);
      if (!shardStatus[1]) {
        console.log(`  round ${roundId}: snapshot shard ${shard + 1}/${SHARD_COUNT}`);
        await (await pool.connect(caller).snapshotRoundShard(roundId, shard)).wait();
      }
    }

    snapshot = await pool.getShardedSnapshotRound(roundId);
    if (snapshot[3] !== BigInt(SHARD_COUNT)) {
      throw new Error(`Round ${roundId} did not process all ${SHARD_COUNT} shards`);
    }
    if (!snapshot[5]) await (await pool.connect(caller).completeSnapshotRound(roundId)).wait();
  }

  return true;
}

async function finalizePrize(
  pool: VeilPoolV4,
  roundId: bigint,
  prizeIndex: number,
  caller: HardhatEthersSigner,
): Promise<PrizeResult> {
  let status = await pool.getShardedPrizeStatus(roundId, prizeIndex);

  if (!status[0]) {
    await (await pool.connect(caller).drawPrizeShard(roundId, prizeIndex)).wait();
    status = await pool.getShardedPrizeStatus(roundId, prizeIndex);
  }

  if (!status[1]) {
    const shardHandle = await pool.getEncryptedPrizeShard(roundId, prizeIndex);
    const shardProof = await fhevm.publicDecrypt([shardHandle]);
    const shardKey = Object.keys(shardProof.clearValues)[0] as keyof typeof shardProof.clearValues;
    const shard = Number(shardProof.clearValues[shardKey]);
    await (
      await pool.connect(caller).finalizePrizeShard(roundId, prizeIndex, shard, shardProof.decryptionProof)
    ).wait();
    status = await pool.getShardedPrizeStatus(roundId, prizeIndex);
  }

  if (!status[3]) {
    await (await pool.connect(caller).drawPrizeMember(roundId, prizeIndex)).wait();
    status = await pool.getShardedPrizeStatus(roundId, prizeIndex);
  }

  if (!status[4]) {
    const winnerHandle = await pool.getEncryptedPrizeWinner(roundId, prizeIndex);
    const winnerProof = await fhevm.publicDecrypt([winnerHandle]);
    const winnerKey = Object.keys(winnerProof.clearValues)[0] as keyof typeof winnerProof.clearValues;
    const winner = String(winnerProof.clearValues[winnerKey]);
    const encodedWinner = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [winner]);
    await (
      await pool.connect(caller).finalizePrizeMember(roundId, prizeIndex, encodedWinner, winnerProof.decryptionProof)
    ).wait();
    status = await pool.getShardedPrizeStatus(roundId, prizeIndex);
  }

  return { shard: Number(status[2]), winner: status[5] };
}

async function readFinalizedPrizes(pool: VeilPoolV4, roundId: bigint): Promise<PrizeResult[]> {
  const results: PrizeResult[] = [];
  for (let prizeIndex = 0; prizeIndex < PRIZE_SLOTS; prizeIndex++) {
    const status = await pool.getShardedPrizeStatus(roundId, prizeIndex);
    if (!status[4]) throw new Error(`Round ${roundId} prize ${prizeIndex} is not finalized`);
    results.push({ shard: Number(status[2]), winner: status[5] });
  }
  return results;
}

async function loadSystem(addresses: V4Addresses): Promise<System> {
  return {
    asset: (await ethers.getContractAt("MockUSDC", addresses.asset)) as MockUSDC,
    principal: (await ethers.getContractAt(
      "MockUSDCConfidentialWrapper",
      addresses.principal,
    )) as MockUSDCConfidentialWrapper,
    vault: (await ethers.getContractAt("MockYieldVault4626", addresses.vault)) as MockYieldVault4626,
    shares: (await ethers.getContractAt(
      "MockYieldVaultShareConfidentialWrapper",
      addresses.shares,
    )) as MockYieldVaultShareConfidentialWrapper,
    deposits: (await ethers.getContractAt("VeilDepositBatcher", addresses.depositBatcher)) as VeilDepositBatcher,
    withdrawals: (await ethers.getContractAt(
      "VeilWithdrawalBatcher",
      addresses.withdrawalBatcher,
    )) as VeilWithdrawalBatcher,
    pool: (await ethers.getContractAt("VeilPoolV4", addresses.pool)) as VeilPoolV4,
    prizeVault: (await ethers.getContractAt("VeilPrizeVaultV3", addresses.prizeVault)) as VeilPrizeVaultV3,
    manager: (await ethers.getContractAt("VeilStrategyManagerV3", addresses.manager)) as VeilStrategyManagerV3,
  };
}

async function validateWiring(system: System, addresses: V4Addresses): Promise<void> {
  for (const [label, address] of Object.entries(addresses)) {
    if ((await ethers.provider.getCode(address)) === "0x") throw new Error(`${label} has no bytecode at ${address}`);
  }

  requireAddress("pool.asset", await system.pool.asset(), addresses.principal);
  requireAddress("pool.strategyManager", await system.pool.strategyManager(), addresses.manager);
  requireAddress("manager.pool", await system.manager.pool(), addresses.pool);
  requireAddress("manager.principalAsset", await system.manager.principalAsset(), addresses.principal);
  requireAddress("manager.strategyShareAsset", await system.manager.strategyShareAsset(), addresses.shares);
  requireAddress("manager.depositBatcher", await system.manager.depositBatcher(), addresses.depositBatcher);
  requireAddress("manager.withdrawalBatcher", await system.manager.withdrawalBatcher(), addresses.withdrawalBatcher);
  requireAddress("manager.vault", await system.manager.vault(), addresses.vault);
  requireAddress("manager.prizeVault", await system.manager.prizeVault(), addresses.prizeVault);
  requireAddress("prizeVault.pool", await system.prizeVault.pool(), addresses.pool);
  requireAddress("prizeVault.asset", await system.prizeVault.asset(), addresses.shares);
  requireAddress("principal.underlying", await system.principal.underlying(), addresses.asset);
  requireAddress("shares.underlying", await system.shares.underlying(), addresses.vault);
  requireAddress("vault.asset", await system.vault.asset(), addresses.asset);
  requireAddress("depositBatcher.fromToken", await system.deposits.fromToken(), addresses.principal);
  requireAddress("depositBatcher.toToken", await system.deposits.toToken(), addresses.shares);
  requireAddress("withdrawalBatcher.fromToken", await system.withdrawals.fromToken(), addresses.shares);
  requireAddress("withdrawalBatcher.toToken", await system.withdrawals.toToken(), addresses.principal);

  if ((await system.pool.SHARD_COUNT()) !== 24n) throw new Error("V4 SHARD_COUNT is not 24");
  if ((await system.pool.SHARD_SIZE()) !== 24n) throw new Error("V4 SHARD_SIZE is not 24");
  if ((await system.pool.MAX_ACTIVE_SAVERS()) !== 576n) throw new Error("V4 MAX_ACTIVE_SAVERS is not 576");
  if ((await system.pool.PRIZE_SLOTS()) !== 3n) throw new Error("V4 PRIZE_SLOTS is not 3");
}

async function run() {
  if (network.name !== "sepolia") {
    throw new Error("Run this script on Sepolia: npm run smoke:v4:sepolia");
  }

  await fhevm.initializeCLIApi();
  const [deployer, alice, bob] = (await ethers.getSigners()) as HardhatEthersSigner[];
  if (!deployer || !alice || !bob) throw new Error("Expected deployer, Alice, and Bob Sepolia signers");

  const addresses = {} as V4Addresses;
  for (const key of Object.keys(V4_ADDRESS_ENV) as AddressKey[]) addresses[key] = await resolveAddress(key);
  const system = await loadSystem(addresses);

  console.log("UNVEIL V4 Sepolia sharded-draw smoke — TEST/DEMO asset");
  console.log(`  deployer: ${deployer.address}`);
  console.log(`  Alice:    ${alice.address}`);
  console.log(`  Bob:      ${bob.address}`);
  console.log(`  pool:     ${addresses.pool}`);

  await validateWiring(system, addresses);
  console.log("  deployment bytecode and V4 wiring: verified");

  await ensureGas(deployer, alice);
  await ensureGas(deployer, bob);
  console.log("  signer ETH balances: sufficient");

  console.log("A. CONFIDENTIAL DEPOSITS");
  await ensureDeposit(system, alice);
  await ensureDeposit(system, bob);
  if ((await system.pool.playerCount()) !== 2n) {
    throw new Error("Fresh V4 smoke stack does not contain exactly the two expected active saver seats");
  }
  if ((await system.principal.confidentialBalanceOf(addresses.pool)) !== ethers.ZeroHash) {
    throw new Error("Pool principal wrapper custody is nonzero");
  }
  if ((await system.principal.confidentialBalanceOf(addresses.manager)) === ethers.ZeroHash) {
    throw new Error("Manager principal wrapper custody handle is empty after deposits");
  }

  const aliceEligible = await system.pool.seatEligibleFromRoundId(alice.address);
  const bobEligible = await system.pool.seatEligibleFromRoundId(bob.address);
  if (aliceEligible !== bobEligible || aliceEligible < 2n) {
    throw new Error(`Unexpected seat maturity boundary: Alice=${aliceEligible}, Bob=${bobEligible}`);
  }
  const firstRound = aliceEligible - 1n;
  console.log(`  both savers deposited 100 encrypted units; first maturity boundary round: ${aliceEligible}`);

  console.log("B. SHARDED SNAPSHOT / MATURITY RESUME");
  for (let offset = 0; offset < MAX_ROUNDS_TO_MATURITY; offset++) {
    const roundId = firstRound + BigInt(offset);
    if (!(await snapshotRound(system.pool, roundId, deployer))) return;

    let state = Number(await system.pool.getDrawState(roundId));
    console.log(`  round ${roundId}: ${namedDrawState(state)}`);
    if (state === 5) continue;
    if (state !== 1 && state !== 2 && state !== 3 && state !== 4) {
      throw new Error(`Round ${roundId} entered unexpected state ${namedDrawState(state)}`);
    }

    const aliceWeight = await decrypt64(
      addresses.pool,
      await system.pool.connect(alice).encryptedSnapshotWeightOf(roundId),
      alice,
    );
    const bobWeight = await decrypt64(
      addresses.pool,
      await system.pool.connect(bob).encryptedSnapshotWeightOf(roundId),
      bob,
    );
    console.log(`  round ${roundId} private maturity: Alice=${aliceWeight}, Bob=${bobWeight}`);

    const positive = new Set<string>();
    if (aliceWeight > 0n) positive.add(alice.address.toLowerCase());
    if (bobWeight > 0n) positive.add(bob.address.toLowerCase());

    let results: PrizeResult[];
    if (state === 1 || state === 2) {
      console.log("C. TWO-STAGE ENCRYPTED PRIZE DRAW");
      results = [];
      for (let prizeIndex = 0; prizeIndex < PRIZE_SLOTS; prizeIndex++) {
        const result = await finalizePrize(system.pool, roundId, prizeIndex, deployer);
        results.push(result);
        console.log(`  prize ${prizeIndex}: shard=${result.shard} winner=${result.winner}`);
      }
      state = Number(await system.pool.getDrawState(roundId));
    } else {
      results = await readFinalizedPrizes(system.pool, roundId);
      console.log(`  round ${roundId}: reusing its already-finalized prize results`);
    }

    if (positive.size === 0) {
      if (state !== 4) throw new Error(`All-zero round ${roundId} did not end CANCELLED`);
      if (results.some((result) => result.winner !== ethers.ZeroAddress)) {
        throw new Error(`All-zero round ${roundId} produced a nonzero winner`);
      }
      console.log(`  round ${roundId}: all-zero maturity correctly CANCELLED; advancing to next boundary`);
      continue;
    }

    for (const result of results) {
      if (!positive.has(result.winner.toLowerCase())) {
        throw new Error(`Round ${roundId} selected zero-weight or unexpected winner ${result.winner}`);
      }
    }

    if (aliceWeight === DEMO_DEPOSIT && bobWeight === DEMO_DEPOSIT) {
      if (state !== 3) throw new Error(`Mature V4 round ${roundId} is not FINALIZED`);
      const info = await system.pool.getDrawInfo(roundId);
      if (info[2] !== 3n || info[3] !== 3n || info[4] !== 3n) {
        throw new Error(`Mature V4 round ${roundId} did not finalize all three winning prize slots`);
      }
      console.log(`  mature round ${roundId}: all three two-stage prizes finalized to eligible savers`);
      console.log("\nUNVEIL V4 Sepolia sharded-draw smoke PASSED");
      return;
    }

    if (state !== 3) throw new Error(`Transitional positive-weight round ${roundId} is not FINALIZED`);
    console.log(`  round ${roundId}: transitional maturity settled safely; advancing to the next boundary`);
  }

  throw new Error(`V4 smoke did not reach two fully mature 100-unit savers within ${MAX_ROUNDS_TO_MATURITY} rounds`);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
