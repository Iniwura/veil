import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { deployments, ethers, fhevm, network } from "hardhat";

import {
  MockUSDC,
  MockUSDCConfidentialWrapper,
  MockYieldVault4626,
  MockYieldVaultShareConfidentialWrapper,
  VeilDepositBatcher,
  VeilPoolV2,
  VeilPrizeVaultV2,
  VeilStrategyManagerV2,
  VeilWithdrawalBatcher,
} from "../types";
import { V2_DEPLOYMENT_NAMES } from "../deploy/deploy-v2";

const MAX_OPERATOR_UNTIL = 2n ** 48n - 1n;
const DEMO_DEPOSIT = 100n;
const DEMO_DONATION = 50n;
const V2_ADDRESS_ENV = {
  asset: "UNVEIL_V2_MOCK_USDC_ADDRESS",
  principal: "UNVEIL_V2_PRINCIPAL_WRAPPER_ADDRESS",
  vault: "UNVEIL_V2_MOCK_YIELD_VAULT_ADDRESS",
  shares: "UNVEIL_V2_SHARE_WRAPPER_ADDRESS",
  depositBatcher: "UNVEIL_V2_DEPOSIT_BATCHER_ADDRESS",
  withdrawalBatcher: "UNVEIL_V2_WITHDRAWAL_BATCHER_ADDRESS",
  pool: "UNVEIL_V2_POOL_ADDRESS",
  prizeVault: "UNVEIL_V2_PRIZE_VAULT_ADDRESS",
  manager: "UNVEIL_V2_MANAGER_ADDRESS",
} as const;

type AddressKey = keyof typeof V2_ADDRESS_ENV;
type V2Addresses = Record<AddressKey, string>;

function requireAddress(label: string, actual: string, expected: string): void {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`UNVEIL_V2 wiring mismatch: ${label} is ${actual}, expected ${expected}`);
  }
}

async function resolveAddress(key: AddressKey): Promise<string> {
  const envName = V2_ADDRESS_ENV[key];
  const configured = process.env[envName];
  if (configured !== undefined) {
    const value = configured.trim();
    if (!ethers.isAddress(value)) throw new Error(`${envName} is not a valid address`);
    return value;
  }

  try {
    return (await deployments.get(V2_DEPLOYMENT_NAMES[key])).address;
  } catch {
    throw new Error(
      `Missing ${V2_DEPLOYMENT_NAMES[key]}. Deploy the fresh V2 stack first or provide ${envName}; no V1 fallback is allowed.`,
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
  if (process.env.UNVEIL_V2_SMOKE_WAIT !== "true") {
    console.log("  Exiting cleanly. Set UNVEIL_V2_SMOKE_WAIT=true to poll real Sepolia time and continue.");
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
  if (deployerBalance < target - balance + minimum) {
    throw new Error(`Insufficient deployer ETH to fund ${signer.address} for the smoke test`);
  }
  await (await deployer.sendTransaction({ to: signer.address, value: target - balance })).wait();
}

async function encryptedInput(contractAddress: string, signer: HardhatEthersSigner, amount: bigint) {
  return fhevm.createEncryptedInput(contractAddress, signer.address).add64(amount).encrypt();
}

async function decrypt64(contractAddress: string, handle: string, signer: HardhatEthersSigner): Promise<bigint> {
  if (handle === ethers.ZeroHash) return 0n;
  return fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddress, signer);
}

async function ensureOperator(
  token: MockUSDCConfidentialWrapper | MockYieldVaultShareConfidentialWrapper,
  holder: HardhatEthersSigner,
  operator: string,
): Promise<void> {
  if (!(await token.isOperator(holder.address, operator))) {
    await (await token.connect(holder).setOperator(operator, MAX_OPERATOR_UNTIL)).wait();
  }
}

async function ensureDeposit(
  token: MockUSDC,
  principal: MockUSDCConfidentialWrapper,
  pool: VeilPoolV2,
  account: HardhatEthersSigner,
  amount: bigint,
): Promise<void> {
  const poolAddress = await pool.getAddress();
  if (!(await pool.joined(account.address))) {
    const currentPrincipal = await decrypt64(
      await principal.getAddress(),
      await principal.confidentialBalanceOf(account.address),
      account,
    );
    if (currentPrincipal > amount) throw new Error(`${account.address} has more than the expected demo principal`);
    const needed = amount - currentPrincipal;
    if (needed > 0n) {
      const underlyingBalance = await token.balanceOf(account.address);
      if (underlyingBalance < needed) {
        await (await token.mint(account.address, needed - underlyingBalance)).wait();
      }
      await (await token.connect(account).approve(await principal.getAddress(), needed)).wait();
      await (await principal.connect(account).wrap(account.address, needed)).wait();
    }
    const input = await encryptedInput(poolAddress, account, amount);
    await (await pool.connect(account).deposit(input.handles[0], input.inputProof)).wait();
  }

  await ensureOperator(principal, account, poolAddress);
  const balance = await decrypt64(poolAddress, await pool.connect(account).encryptedBalanceOf(), account);
  if (balance !== amount) throw new Error(`Unexpected private ${account.address} pool balance`);
}

async function proveAndCallbackDeposit(
  batcher: VeilDepositBatcher,
  principal: MockUSDCConfidentialWrapper,
  batchId: bigint,
): Promise<void> {
  const requestId = await batcher.unwrapRequestId(batchId);
  const encryptedAmount = await principal.unwrapAmount(requestId);
  const result = await fhevm.publicDecrypt([encryptedAmount]);
  const clearAmount = result.clearValues[
    Object.keys(result.clearValues)[0] as keyof typeof result.clearValues
  ] as bigint;
  await (await batcher.dispatchBatchCallback(batchId, clearAmount, result.decryptionProof)).wait();
}

async function resolveDepositBatch(
  manager: VeilStrategyManagerV2,
  batcher: VeilDepositBatcher,
  principal: MockUSDCConfidentialWrapper,
  batchId: bigint,
): Promise<boolean> {
  const state = Number(await batcher.batchState(batchId));
  if (state === 1) {
    await proveAndCallbackDeposit(batcher, principal, batchId);
  }
  const finalState = Number(await batcher.batchState(batchId));
  if (finalState !== 2 && finalState !== 3) return false;
  if (!(await manager.managerDepositBatchResolved(batchId))) {
    await (await manager.resolveDepositBatch(batchId)).wait();
  }
  return true;
}

async function investAndResolve(
  manager: VeilStrategyManagerV2,
  batcher: VeilDepositBatcher,
  principal: MockUSDCConfidentialWrapper,
): Promise<boolean> {
  const batchId = await batcher.currentBatchId();
  const total = await batcher.totalDeposits(batchId);
  if (batchId > 1n && total === ethers.ZeroHash) {
    console.log("  deposit route already advanced beyond the current empty batch; not reinvesting");
    return true;
  }
  if (total === ethers.ZeroHash) {
    await (await manager.investExcess()).wait();
  } else {
    console.log(`  deposit batch ${batchId} already contains the manager investment`);
  }

  const state = Number(await batcher.batchState(batchId));
  if (state === 0) {
    const openedAt = Number(await batcher.currentBatchOpenedAt());
    const age = Number(await batcher.minimumBatchAge());
    if (!(await waitForRealTime(`deposit batch ${batchId}`, openedAt + age))) return false;
    await (await batcher.dispatchBatch()).wait();
  }
  return resolveDepositBatch(manager, batcher, principal, batchId);
}

async function proveAndCallbackWithdrawal(
  batcher: VeilWithdrawalBatcher,
  shares: MockYieldVaultShareConfidentialWrapper,
  batchId: bigint,
): Promise<void> {
  const requestId = await batcher.unwrapRequestId(batchId);
  const encryptedAmount = await shares.unwrapAmount(requestId);
  const result = await fhevm.publicDecrypt([encryptedAmount]);
  const clearAmount = result.clearValues[
    Object.keys(result.clearValues)[0] as keyof typeof result.clearValues
  ] as bigint;
  await (await batcher.dispatchBatchCallback(batchId, clearAmount, result.decryptionProof)).wait();
}

async function settleQueuedWithdrawal(
  manager: VeilStrategyManagerV2,
  batcher: VeilWithdrawalBatcher,
  shares: MockYieldVaultShareConfidentialWrapper,
  requestId: bigint,
): Promise<boolean> {
  const batchId = await manager.lastManagerWithdrawalBatchId();
  const state = Number(await batcher.batchState(batchId));
  if (state === 1) await proveAndCallbackWithdrawal(batcher, shares, batchId);
  const finalState = Number(await batcher.batchState(batchId));
  if (finalState !== 2 && finalState !== 3) return false;
  if (!(await manager.managerWithdrawalBatchResolved(batchId))) {
    await (await manager.resolveWithdrawalBatch(batchId)).wait();
  }

  const requestBeforeSettle = await manager.withdrawalRequest(requestId);
  if (!requestBeforeSettle.settled) {
    await (await manager.settleWithdrawal(requestId)).wait();
    const requestAfterSettle = await manager.withdrawalRequest(requestId);
    const result = await fhevm.publicDecrypt([requestAfterSettle.completed]);
    const completed = result.clearValues[
      Object.keys(result.clearValues)[0] as keyof typeof result.clearValues
    ] as boolean;
    if (!completed) throw new Error("Queued withdrawal did not complete after strategy settlement");
    await (await manager.finalizeWithdrawal(requestId, completed, result.decryptionProof)).wait();
  }
  return true;
}

async function run() {
  if (network.name !== "sepolia") {
    throw new Error("Run this script on Sepolia: npm run smoke:v2:sepolia");
  }

  await fhevm.initializeCLIApi();
  const [deployer, alice, bob] = (await ethers.getSigners()) as HardhatEthersSigner[];
  if (!deployer || !alice || !bob) throw new Error("Expected deployer, Alice, and Bob Sepolia signers");

  const addresses = {} as V2Addresses;
  for (const key of Object.keys(V2_ADDRESS_ENV) as AddressKey[]) addresses[key] = await resolveAddress(key);

  const asset = (await ethers.getContractAt("MockUSDC", addresses.asset)) as MockUSDC;
  const principal = (await ethers.getContractAt(
    "MockUSDCConfidentialWrapper",
    addresses.principal,
  )) as MockUSDCConfidentialWrapper;
  const vault = (await ethers.getContractAt("MockYieldVault4626", addresses.vault)) as MockYieldVault4626;
  const shares = (await ethers.getContractAt(
    "MockYieldVaultShareConfidentialWrapper",
    addresses.shares,
  )) as MockYieldVaultShareConfidentialWrapper;
  const deposits = (await ethers.getContractAt("VeilDepositBatcher", addresses.depositBatcher)) as VeilDepositBatcher;
  const withdrawals = (await ethers.getContractAt(
    "VeilWithdrawalBatcher",
    addresses.withdrawalBatcher,
  )) as VeilWithdrawalBatcher;
  const pool = (await ethers.getContractAt("VeilPoolV2", addresses.pool)) as VeilPoolV2;
  const prizeVault = (await ethers.getContractAt("VeilPrizeVaultV2", addresses.prizeVault)) as VeilPrizeVaultV2;
  const manager = (await ethers.getContractAt("VeilStrategyManagerV2", addresses.manager)) as VeilStrategyManagerV2;

  console.log("UNVEIL V2 Sepolia smoke — TEST/DEMO simulated strategy");
  console.log(`  deployer: ${deployer.address}`);
  console.log(`  Alice:    ${alice.address}`);
  console.log(`  Bob:      ${bob.address}`);

  for (const [label, address] of Object.entries(addresses)) {
    if ((await ethers.provider.getCode(address)) === "0x") throw new Error(`${label} has no bytecode at ${address}`);
  }

  requireAddress("pool.strategyManager", await pool.strategyManager(), addresses.manager);
  requireAddress("manager.pool", await manager.pool(), addresses.pool);
  requireAddress("manager.principalAsset", await manager.principalAsset(), addresses.principal);
  requireAddress("manager.strategyShareAsset", await manager.strategyShareAsset(), addresses.shares);
  requireAddress("manager.depositBatcher", await manager.depositBatcher(), addresses.depositBatcher);
  requireAddress("manager.withdrawalBatcher", await manager.withdrawalBatcher(), addresses.withdrawalBatcher);
  requireAddress("manager.vault", await manager.vault(), addresses.vault);
  requireAddress("manager.prizeVault", await manager.prizeVault(), addresses.prizeVault);
  requireAddress("prizeVault.pool", await prizeVault.pool(), addresses.pool);
  requireAddress("prizeVault.asset", await prizeVault.asset(), addresses.shares);

  await ensureGas(deployer, alice);
  await ensureGas(deployer, bob);
  console.log("  signer ETH balances: sufficient");

  console.log("A/B. CONFIDENTIAL SETUP AND DEPOSITS");
  await ensureDeposit(asset, principal, pool, alice, DEMO_DEPOSIT);
  await ensureDeposit(asset, principal, pool, bob, DEMO_DEPOSIT);
  if ((await principal.confidentialBalanceOf(addresses.pool)) !== ethers.ZeroHash) {
    throw new Error("Pool principal wrapper custody is nonzero");
  }
  if ((await principal.confidentialBalanceOf(addresses.manager)) === ethers.ZeroHash) {
    throw new Error("Manager principal wrapper custody handle is empty");
  }
  console.log("  Alice and Bob private balances verified with their own credentials");
  console.log("  pool principal-token custody: zero; manager aggregate custody: encrypted");

  console.log("C. STRATEGY INVESTMENT AND PUBLIC-DECRYPTION CALLBACK");
  if (!(await investAndResolve(manager, deposits, principal))) return;
  if ((await shares.confidentialBalanceOf(addresses.manager)) === ethers.ZeroHash) {
    throw new Error("Manager did not receive confidential strategy shares");
  }
  console.log("  manager confidential strategy-share custody handle is populated");

  console.log("D. SIMULATED YIELD");
  console.log("  TEST/DEMO ONLY: simulating ERC4626 appreciation");
  const totalAssets = await vault.totalAssets();
  const totalShares = await vault.totalSupply();
  if (totalAssets === totalShares) {
    await (await asset.mint(deployer.address, DEMO_DONATION)).wait();
    await (await asset.connect(deployer).approve(addresses.vault, DEMO_DONATION)).wait();
    await (await vault.connect(deployer).donate(DEMO_DONATION)).wait();
  } else {
    console.log("  simulated appreciation already exists; not donating again");
  }

  console.log("E. AUTONOMOUS DRAW");
  const roundId = await pool.nextRoundId();
  let drawState = Number(await pool.getDrawState(roundId));
  if (drawState === 0) {
    let schedule = await pool.getDrawSchedule();
    if (!schedule.ready) {
      if (schedule.insufficientParticipants) {
        throw new Error(`Draw ${roundId} is SKIPPABLE for insufficient participation; no winner handle exists`);
      }
      if (!(await waitForRealTime(`draw ${roundId}`, Number(schedule.closesAt)))) return;
      schedule = await pool.getDrawSchedule();
      if (!schedule.ready) throw new Error(`Draw ${roundId} did not become ready at ${schedule.closesAt}`);
    }
    await (await pool.connect(bob).snapshotRound()).wait();
    drawState = Number(await pool.getDrawState(roundId));
  }
  if (drawState === 1) {
    await (await pool.connect(bob).blindDraw(roundId)).wait();
    drawState = 2;
  }
  if (drawState === 2) {
    const encryptedWinner = await pool.getEncryptedWinner(roundId);
    const result = await fhevm.publicDecrypt([encryptedWinner]);
    await (
      await pool.connect(deployer).finalizeWinner(roundId, result.abiEncodedClearValues, result.decryptionProof)
    ).wait();
  }
  if (Number(await pool.getDrawState(roundId)) !== 3) throw new Error(`Draw ${roundId} is not FINALIZED`);
  const winnerAddress = await pool.getWinner(roundId);
  const winner = [alice, bob].find((candidate) => candidate.address.toLowerCase() === winnerAddress.toLowerCase());
  if (!winner) throw new Error(`Unexpected winner ${winnerAddress}; expected Alice or Bob`);
  const loser = winner.address.toLowerCase() === alice.address.toLowerCase() ? bob : alice;
  console.log(`  winner: ${winnerAddress}`);

  console.log("F. DIRECT CONFIDENTIAL PRIZE DELIVERY");
  const prizePointer = await manager.nextPrizeRoundId();
  if (prizePointer < roundId) {
    throw new Error(`Prize pointer is blocked at earlier round ${prizePointer}; process FIFO before rerunning`);
  }
  const statusBefore = await prizeVault.prizeStatus(roundId);
  if (prizePointer === roundId && !statusBefore.processed) {
    const winnerBefore = await decrypt64(addresses.shares, await shares.confidentialBalanceOf(winner.address), winner);
    await (await manager.connect(alice).processNextPrizeRound()).wait();
    const encryptedPrize = await prizeVault.connect(winner).encryptedPrizeOf(roundId);
    const delivered = await decrypt64(addresses.prizeVault, encryptedPrize, winner);
    const winnerAfter = await decrypt64(addresses.shares, await shares.confidentialBalanceOf(winner.address), winner);
    if (winnerAfter !== winnerBefore + delivered)
      throw new Error("Winner share balance did not increase by the delivered prize");
    const status = await prizeVault.prizeStatus(roundId);
    if (!status.processed) throw new Error("Prize was not marked processed");
    try {
      await prizeVault.connect(loser).encryptedPrizeOf(roundId);
      throw new Error("Loser unexpectedly received the winner-only prize handle");
    } catch (error) {
      if (error instanceof Error && error.message.includes("Loser unexpectedly")) throw error;
    }
    console.log(`  prize delivered: ${delivered} confidential strategy-share units`);
  } else {
    if (!statusBefore.processed) throw new Error("Prize pointer advanced without a processed prize");
    console.log("  round prize already processed; no duplicate processing submitted");
  }

  console.log("G. QUEUED WITHDRAWAL AND PUBLIC-DECRYPTION CALLBACKS");
  const requestId = await manager.nextWithdrawalRequestId();
  let request = await manager.withdrawalRequest(requestId);
  if (!request.exists) {
    const input = await encryptedInput(addresses.pool, alice, DEMO_DEPOSIT);
    await (await pool.connect(alice).withdraw(input.handles[0], input.inputProof)).wait();
    request = await manager.withdrawalRequest(requestId);
  }
  if (!request.exists) throw new Error("Withdrawal request was not recorded");
  if (!request.settled) {
    const queueState = await manager.withdrawalRequestQueueState(requestId);
    if (!queueState.classified) {
      const completion = await fhevm.publicDecrypt([request.completed]);
      const completed = completion.clearValues[
        Object.keys(completion.clearValues)[0] as keyof typeof completion.clearValues
      ] as boolean;
      if (completed)
        throw new Error("Demo withdrawal became instant; fresh demo conditions should produce a queued request");
      await (await manager.connect(bob).classifyWithdrawal(requestId, completed, completion.decryptionProof)).wait();
    }
    let withdrawalBatchId = await manager.lastManagerWithdrawalBatchId();
    if (!(await manager.managerWithdrawalBatch(withdrawalBatchId))) {
      await (await manager.fundWithdrawalLiquidity()).wait();
      withdrawalBatchId = await manager.lastManagerWithdrawalBatchId();
    }
    const openedAt = Number(await withdrawals.currentBatchOpenedAt());
    const batchAge = Number(await withdrawals.minimumBatchAge());
    const withdrawalState = Number(await withdrawals.batchState(withdrawalBatchId));
    if (withdrawalState === 0) {
      if (!(await waitForRealTime(`withdrawal batch ${withdrawalBatchId}`, openedAt + batchAge))) return;
      await (await withdrawals.dispatchBatch()).wait();
    }
    if (!(await settleQueuedWithdrawal(manager, withdrawals, shares, requestId))) return;
    request = await manager.withdrawalRequest(requestId);
  } else {
    console.log("  withdrawal request already settled; no duplicate funding or settlement submitted");
  }
  if (!request.settled) throw new Error("Withdrawal request was not finalized");
  console.log("  queued withdrawal completed through strategy redemption and KMS proofs");

  console.log("H. FINAL INVARIANTS");
  if ((await principal.confidentialBalanceOf(addresses.pool)) !== ethers.ZeroHash) {
    throw new Error("Final pool principal-token custody is nonzero");
  }
  const aliceActive = await decrypt64(addresses.pool, await pool.connect(alice).encryptedBalanceOf(), alice);
  const aliceReserved = await decrypt64(
    addresses.pool,
    await pool.connect(alice).encryptedReservedWithdrawalOf(),
    alice,
  );
  const bobActive = await decrypt64(addresses.pool, await pool.connect(bob).encryptedBalanceOf(), bob);
  const bobReserved = await decrypt64(addresses.pool, await pool.connect(bob).encryptedReservedWithdrawalOf(), bob);
  if (aliceActive + aliceReserved + bobActive + bobReserved !== DEMO_DEPOSIT) {
    throw new Error("Private active-plus-reserved principal accounting did not settle to the remaining Bob position");
  }
  if ((await manager.principalLiability()) === ethers.ZeroHash) throw new Error("Manager liability handle is missing");
  if ((await manager.queuedWithdrawalTotal()) === ethers.ZeroHash) {
    console.log("  queued withdrawal total is represented by an encrypted zero handle after settlement");
  }
  if ((await manager.nextPrizeRoundId()) <= roundId) throw new Error("Prize pointer did not advance");
  if (Number(await pool.getDrawState(roundId)) !== 3) throw new Error("Draw state is not FINALIZED");
  console.log("  principal custody, private user accounting, draw finalization, and prize pointer verified");
  console.log("\nUNVEIL V2 Sepolia smoke PASSED");
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
