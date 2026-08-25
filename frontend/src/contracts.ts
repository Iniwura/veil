export const UNVEIL_NETWORK = {
  chainId: 11155111,
  name: "Sepolia",
  explorer: "https://sepolia.etherscan.io",
} as const;

export const UNVEIL_CONTRACTS = {
  underlying: "0x54350EE95601Ed535039993a5eE05FdA1Bd0Ae0C",
  principal: "0xc948EDA1EA4c29d09965d1A15C3AC5B38cBdBB13",
  vault: "0xa39F57644e77FDb6E4F705F67BC08710d366d289",
  shares: "0x48129B9c003b69987143d2622dC632Bc651E1F61",
  depositBatcher: "0xb7BFbb875DCF3bd7c0B30536eBf60c284f0De2f1",
  withdrawalBatcher: "0xa5f1B091ac896C01f73d47100666d80961FC4620",
  pool: "0xFC5E4b552f16975d9d0B28Ab8cd14eE4a3d3Dc76",
  prizeVault: "0x0Dc3d8978ee509EFb71183377E5EAf2f28420525",
  manager: "0xFF4106998079309500Ad07d41382436f3fC681E7",
} as const;

export const UNVEIL_DEMO = {
  enabled: true,
  label: "TEST/DEMO",
  assetLabel: "TEST TOKEN",
  strategy: "SIMULATED ERC4626",
  productionMarketYield: false,
} as const;
