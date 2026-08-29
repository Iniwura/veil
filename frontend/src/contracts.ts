export const UNVEIL_NETWORK = {
  chainId: 11155111,
  name: "Sepolia",
  explorer: "https://sepolia.etherscan.io",
} as const;

export const UNVEIL_CONTRACTS = {
  underlying: "0x3E6CF78DC80ccc4921fBd641C937AA80fD2BE6a4",
  principal: "0xE792dddcbe8a112CeA2061B02822A4ba041F21AD",
  vault: "0xE0F130b9e5667486C2fA6Ddf8c701362ac865609",
  shares: "0x616B2e4d1eBa6F6c846E046f80557c2fBc8d4C81",
  depositBatcher: "0xF43CB3bf5Af83c874EC801e2a912B55faE51937A",
  withdrawalBatcher: "0x26B9A8BDB7b1d1cDbA4c3f22C49b4Ea060aEb2c1",
  pool: "0x7d52f69d129D298BDDD6Deeb838541e020Cc265f",
  prizeVault: "0xbfcc93BbB2121a69b9E0516E4039122BFFaFbD11",
  manager: "0xdEf45aC259025b2833030DCC42aCD66225A0f3d1",
} as const;

export const UNVEIL_DEMO = {
  enabled: true,
  label: "SEPOLIA TESTNET · DEMO ASSET",
  assetLabel: "cUSDC",
  technicalAssetSymbol: "t-cUSDC",
  strategy: "SIMULATED ERC4626",
  productionMarketYield: false,
} as const;
