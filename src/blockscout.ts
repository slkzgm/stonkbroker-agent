import { formatUnits, getAddress, type Address } from "viem";

import { BLOCKSCOUT_API_URL } from "./constants.js";
import type { PortfolioPosition, RobinhoodAsset } from "./types.js";

interface TokenBalanceItem {
  value?: string;
  token?: {
    address_hash?: string;
    decimals?: string | null;
    exchange_rate?: string | null;
  };
}

export async function fetchCanonicalPortfolio(
  wallet: Address,
  canonicalAssets: Map<string, RobinhoodAsset>,
  fetcher: typeof fetch = fetch,
): Promise<PortfolioPosition[]> {
  const response = await fetcher(`${BLOCKSCOUT_API_URL}/addresses/${wallet}/token-balances`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Blockscout returned HTTP ${response.status} for token balances`);
  }

  const items = (await response.json()) as TokenBalanceItem[];
  const positions: PortfolioPosition[] = [];

  for (const item of items) {
    const rawAddress = item.token?.address_hash;
    if (!rawAddress || !item.value) continue;
    const asset = canonicalAssets.get(getAddress(rawAddress).toLowerCase());
    if (!asset) continue;
    const rawBalance = BigInt(item.value);
    if (rawBalance === 0n) continue;
    const decimals = Number(item.token?.decimals ?? "18");
    positions.push({
      asset,
      rawBalance,
      decimals,
      formattedBalance: formatUnits(rawBalance, decimals),
      ...(item.token?.exchange_rate
        ? { exchangeRateUsd: item.token.exchange_rate }
        : {}),
    });
  }

  return positions.sort((left, right) => left.asset.symbol.localeCompare(right.asset.symbol));
}
