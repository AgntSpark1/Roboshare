import { parseAbi, type Address } from "viem";

/**
 * Aave V3 on BNB Smart Chain, read-only. Addresses copied from the official BGD Labs address book
 * (github.com/bgd-labs/aave-address-book, src/AaveV3BNB.sol, commit 6a83d11893d6687bf6b9fd091a2a5320b3e1966e,
 * 2026-10-09). The worker re-checks them on-chain before every read (provider.getPool() etc.).
 * RoboShare never sends transactions to Aave.
 */
export interface AaveDeployment {
  chainId: number;
  poolAddressesProvider: Address;
  pool: Address;
  oracle: Address;
  dataProvider: Address;
  source: string;
}

export const AAVE_V3_BNB: AaveDeployment = {
  chainId: 56,
  poolAddressesProvider: "0xff75B6da14FfbbfD355Daf7a2731456b3562Ba6D",
  pool: "0x6807dc923806fE8Fd134338EABCA509979a7e0cB",
  oracle: "0x39bc1bfDa2130d6Bb6DBEfd366939b4c7aa7C697",
  dataProvider: "0xc90Df74A7c16245c5F5C5870327Ceb38Fe5d5328",
  source: "bgd-labs/aave-address-book@6a83d11893d6687bf6b9fd091a2a5320b3e1966e:src/AaveV3BNB.sol",
};

export interface AllowlistedReserve {
  symbol: string;
  underlying: Address;
  decimals: number;
}

/** Reserves shown in the UI. Same source and commit as AAVE_V3_BNB. */
export const AAVE_BNB_ALLOWLIST: readonly AllowlistedReserve[] = [
  { symbol: "USDT", underlying: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
  { symbol: "USDC", underlying: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
  { symbol: "FDUSD", underlying: "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409", decimals: 18 },
  { symbol: "WBNB", underlying: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18 },
  { symbol: "BTCB", underlying: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", decimals: 18 },
  { symbol: "ETH", underlying: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18 },
];

// Minimal read-only ABIs, matching aave-dao/aave-v3-origin interfaces (commit 8305565a).
export const aavePoolAddressesProviderAbi = parseAbi([
  "function getPool() view returns (address)",
  "function getPriceOracle() view returns (address)",
  "function getPoolDataProvider() view returns (address)",
]);

export const aavePoolDataProviderAbi = parseAbi([
  "struct TokenData { string symbol; address tokenAddress; }",
  "function getAllReservesTokens() view returns (TokenData[])",
  "function getReserveConfigurationData(address asset) view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)",
  "function getReserveCaps(address asset) view returns (uint256 borrowCap, uint256 supplyCap)",
  "function getPaused(address asset) view returns (bool isPaused)",
  "function getReserveData(address asset) view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)",
]);

export const aaveOracleAbi = parseAbi([
  "function BASE_CURRENCY_UNIT() view returns (uint256)",
  "function getAssetPrice(address asset) view returns (uint256)",
]);

export const RAY = 10n ** 27n;

/** Aave rates are annual rates in ray (1e27). Returns basis points, rounded down. */
export function rayToBps(rate: bigint): number {
  return Number((rate * 10_000n) / RAY);
}
