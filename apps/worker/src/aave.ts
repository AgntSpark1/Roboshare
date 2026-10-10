import type { Prisma, PrismaClient } from "@roboshare/db";
import {
  aaveOracleAbi,
  aavePoolAddressesProviderAbi,
  aavePoolDataProviderAbi,
  rayToBps,
  type AaveDeployment,
  type AllowlistedReserve,
} from "@roboshare/shared";
import { getAddress, isAddressEqual, type PublicClient } from "viem";

export class AaveConfigError extends Error {}

export interface AaveReserveRead {
  symbol: string;
  underlying: string;
  decimals: number;
  isActive: boolean;
  isFrozen: boolean;
  isPaused: boolean;
  borrowingEnabled: boolean;
  ltvBps: number;
  liquidationThresholdBps: number;
  reserveFactorBps: number;
  supplyCap: string; // whole tokens, 0 = no cap
  borrowCap: string;
  totalSupplied: string; // base units
  totalVariableDebt: string;
  liquidityRateRay: string;
  variableBorrowRateRay: string;
  supplyAprBps: number;
  variableBorrowAprBps: number;
  priceInBaseCurrency: string;
  baseCurrencyUnit: string;
}

export interface AaveSnapshot {
  chainId: number;
  blockNumber: bigint;
  blockHash: string;
  blockTime: Date;
  source: string;
  addresses: AaveDeployment;
  reserves: AaveReserveRead[];
}

/**
 * Reads allowlisted Aave V3 reserves at one pinned block. Before reading, it checks the chain id,
 * that every expected contract has code, and that the PoolAddressesProvider still points at the
 * expected Pool, Oracle and data provider. Any mismatch throws instead of returning data.
 */
export async function readAaveMarkets(
  client: PublicClient,
  dep: AaveDeployment,
  allowlist: readonly AllowlistedReserve[],
): Promise<AaveSnapshot> {
  const chainId = await client.getChainId();
  if (chainId !== dep.chainId) throw new AaveConfigError(`RPC is chain ${chainId}, expected ${dep.chainId}`);
  const block = await client.getBlock({ blockTag: "latest" });
  const blockNumber = block.number!;

  for (const [name, address] of Object.entries({
    poolAddressesProvider: dep.poolAddressesProvider,
    pool: dep.pool,
    oracle: dep.oracle,
    dataProvider: dep.dataProvider,
  })) {
    const code = await client.getCode({ address, blockNumber });
    if (!code || code === "0x") throw new AaveConfigError(`${name} ${address} has no code`);
  }
  const read = <T>(address: `0x${string}`, abi: any, functionName: string, args: unknown[] = []) =>
    client.readContract({ address, abi, functionName, args, blockNumber } as any) as Promise<T>;

  const [pool, oracle, dataProvider] = await Promise.all([
    read<`0x${string}`>(dep.poolAddressesProvider, aavePoolAddressesProviderAbi, "getPool"),
    read<`0x${string}`>(dep.poolAddressesProvider, aavePoolAddressesProviderAbi, "getPriceOracle"),
    read<`0x${string}`>(dep.poolAddressesProvider, aavePoolAddressesProviderAbi, "getPoolDataProvider"),
  ]);
  for (const [name, actual, expected] of [
    ["pool", pool, dep.pool],
    ["oracle", oracle, dep.oracle],
    ["dataProvider", dataProvider, dep.dataProvider],
  ] as const) {
    if (!isAddressEqual(actual, expected)) {
      throw new AaveConfigError(`PoolAddressesProvider reports ${name} ${actual}, expected ${expected}`);
    }
  }

  const listed = await read<{ symbol: string; tokenAddress: `0x${string}` }[]>(dep.dataProvider, aavePoolDataProviderAbi, "getAllReservesTokens");
  const baseCurrencyUnit = await read<bigint>(dep.oracle, aaveOracleAbi, "BASE_CURRENCY_UNIT");

  const reserves: AaveReserveRead[] = [];
  for (const r of allowlist) {
    if (!listed.some((l) => isAddressEqual(l.tokenAddress, r.underlying))) {
      throw new AaveConfigError(`${r.symbol} ${r.underlying} is not a reserve of this pool`);
    }
    const [cfg, caps, paused, data, price] = await Promise.all([
      read<readonly [bigint, bigint, bigint, bigint, bigint, boolean, boolean, boolean, boolean, boolean]>(dep.dataProvider, aavePoolDataProviderAbi, "getReserveConfigurationData", [r.underlying]),
      read<readonly [bigint, bigint]>(dep.dataProvider, aavePoolDataProviderAbi, "getReserveCaps", [r.underlying]),
      read<boolean>(dep.dataProvider, aavePoolDataProviderAbi, "getPaused", [r.underlying]),
      read<readonly bigint[]>(dep.dataProvider, aavePoolDataProviderAbi, "getReserveData", [r.underlying]),
      read<bigint>(dep.oracle, aaveOracleAbi, "getAssetPrice", [r.underlying]),
    ]);
    if (Number(cfg[0]) !== r.decimals) {
      throw new AaveConfigError(`${r.symbol} decimals ${cfg[0]} differ from allowlist ${r.decimals}`);
    }
    reserves.push({
      symbol: r.symbol,
      underlying: getAddress(r.underlying),
      decimals: r.decimals,
      ltvBps: Number(cfg[1]),
      liquidationThresholdBps: Number(cfg[2]),
      reserveFactorBps: Number(cfg[4]),
      borrowingEnabled: cfg[6],
      isActive: cfg[8],
      isFrozen: cfg[9],
      isPaused: paused,
      borrowCap: caps[0].toString(),
      supplyCap: caps[1].toString(),
      totalSupplied: data[2]!.toString(),
      totalVariableDebt: data[4]!.toString(),
      liquidityRateRay: data[5]!.toString(),
      variableBorrowRateRay: data[6]!.toString(),
      supplyAprBps: rayToBps(data[5]!),
      variableBorrowAprBps: rayToBps(data[6]!),
      priceInBaseCurrency: price.toString(),
      baseCurrencyUnit: baseCurrencyUnit.toString(),
    });
  }
  return {
    chainId,
    blockNumber,
    blockHash: block.hash!,
    blockTime: new Date(Number(block.timestamp) * 1000),
    source: dep.source,
    addresses: dep,
    reserves,
  };
}

export async function saveAaveSnapshot(prisma: PrismaClient, s: AaveSnapshot) {
  return prisma.aaveMarketSnapshot.create({
    data: {
      chainId: s.chainId,
      blockNumber: s.blockNumber,
      blockHash: s.blockHash,
      blockTime: s.blockTime,
      source: s.source,
      addresses: s.addresses as unknown as Prisma.InputJsonValue,
      reserves: s.reserves as unknown as Prisma.InputJsonValue,
    },
  });
}
