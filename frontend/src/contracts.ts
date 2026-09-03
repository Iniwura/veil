export const UNVEIL_NETWORK = {
  chainId: 11155111,
  name: "Sepolia",
  explorer: "https://sepolia.etherscan.io",
} as const;

export const UNVEIL_CONTRACTS = {
  underlying: "0x50c5b93aDc4c10a392b53125C545e760f12E9466",
  principal: "0x9Ff6F110cb3162033A25A597D4528bABbEe2cA41",
  vault: "0x2FcBa2fFc62010717272B3F2223F12730C4BF4b9",
  shares: "0xF0810ef8b962ac787df0fe5FEF492A75A054F55d",
  depositBatcher: "0x391cB3D0F60F443C3018bAC600C6EA90ee6497Fe",
  withdrawalBatcher: "0xe88B1B97ceE0349954e664aF9f1168327588a390",
  pool: "0xCC7d4642557FfE810a77D2CEce0206211d15aE57",
  prizeVault: "0x0f84CE3060aB79de3eCE59C5c9f4a64d642D101C",
  manager: "0x2bA25db644515af6Bb731025e71EE493B9D5d4Db",
} as const;

export const UNVEIL_DEMO = {
  enabled: true,
  label: "SEPOLIA TESTNET · DEMO ASSET",
  assetLabel: "cUSDC",
  technicalAssetSymbol: "t-cUSDC",
  strategy: "SIMULATED ERC4626",
  productionMarketYield: false,
} as const;
