export const UNVEIL_NETWORK = {
  chainId: 11155111,
  name: "Sepolia",
  explorer: "https://sepolia.etherscan.io",
} as const;

export const UNVEIL_CONTRACTS = {
  underlying: "0x8A39C96ed3Af9BEf283C08f78c94CB48E18D5049",
  principal: "0x92943aA8f5148237099ECCEfd127Dcf75686bDbc",
  vault: "0x7e7dFF7B2c717996b71Ef646fC094ec4006522E6",
  shares: "0xA8C58406bFf1DB76D465DdDA32225167E660CdEd",
  depositBatcher: "0x80f2c19C2ba914656506b64F7f52ff1Df4845619",
  withdrawalBatcher: "0x76724905fcC8503c8B7452ED7825621561A59f50",
  pool: "0x3D6EEA53611E30ce0DA705359320F0aa858FeAe7",
  prizeVault: "0x3EC6F4EdfE6146c021871fCa29D9ec01ee10D2af",
  manager: "0xf8aCf3878C90D276B5144b630C54d7c5597d8F6B",
} as const;

export const UNVEIL_DEMO = {
  enabled: true,
  label: "SEPOLIA TESTNET · DEMO ASSET",
  assetLabel: "cUSDC",
  technicalAssetSymbol: "t-cUSDC",
  strategy: "SIMULATED ERC4626",
  productionMarketYield: false,
} as const;
