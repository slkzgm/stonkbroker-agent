import { getAddress, type Address } from "viem";

import { CHAIN_ID, ROBINHOOD_ASSETS_URL } from "./constants.js";
import type { RobinhoodAsset } from "./types.js";

interface ApiDeployment {
  contractAddress?: string;
  contract_address?: string;
  chainId?: number;
  chain_id?: number;
}

interface ApiAsset {
  id?: string;
  tokenSymbol?: string;
  token_symbol?: string;
  tokenName?: string;
  token_name?: string;
  deployments?: ApiDeployment[];
  status?: string;
  logoUrl?: string;
  logo_url?: string;
  tradingCapabilities?: {
    market?: { whole?: string; fractional?: string };
  };
}

export class RobinhoodAssetRegistry {
  private cache?: { expiresAt: number; assets: RobinhoodAsset[] };

  constructor(
    private readonly url = ROBINHOOD_ASSETS_URL,
    private readonly cacheMs = 5 * 60_000,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async list(forceRefresh = false): Promise<RobinhoodAsset[]> {
    const now = Date.now();
    if (!forceRefresh && this.cache && this.cache.expiresAt > now) {
      return this.cache.assets;
    }

    const response = await this.fetcher(this.url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Robinhood asset registry returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as { assets?: ApiAsset[] };
    const assets = (payload.assets ?? [])
      .map(toAsset)
      .filter((asset): asset is RobinhoodAsset => asset !== undefined)
      .sort((left, right) => left.symbol.localeCompare(right.symbol));

    if (assets.length === 0) {
      throw new Error("Robinhood asset registry returned no mainnet assets");
    }

    this.cache = { assets, expiresAt: now + this.cacheMs };
    return assets;
  }

  async resolve(reference: string): Promise<RobinhoodAsset> {
    const assets = await this.list();
    const normalized = reference.toLowerCase();
    const matches = assets.filter(
      (asset) =>
        asset.symbol.toLowerCase() === normalized || asset.address.toLowerCase() === normalized,
    );
    if (matches.length === 0) {
      throw new Error(`Unknown canonical Robinhood stock token: ${reference}`);
    }
    if (matches.length > 1) {
      throw new Error(`Ambiguous Robinhood token symbol: ${reference}; use a contract address`);
    }
    return matches[0]!;
  }

  async byAddress(): Promise<Map<string, RobinhoodAsset>> {
    return new Map((await this.list()).map((asset) => [asset.address.toLowerCase(), asset]));
  }
}

function toAsset(asset: ApiAsset): RobinhoodAsset | undefined {
  const deployment = (asset.deployments ?? []).find(
    (candidate) => (candidate.chainId ?? candidate.chain_id) === CHAIN_ID,
  );
  const rawAddress = deployment?.contractAddress ?? deployment?.contract_address;
  const symbol = asset.tokenSymbol ?? asset.token_symbol;
  const name = asset.tokenName ?? asset.token_name;
  if (!rawAddress || !symbol || !name) return undefined;

  let address: Address;
  try {
    address = getAddress(rawAddress);
  } catch {
    return undefined;
  }

  const market = asset.tradingCapabilities?.market;
  const tradable = [market?.whole, market?.fractional].some(
    (status) => status === "TRADING_STATUS_TRADABLE",
  );

  return {
    id: asset.id ?? address,
    symbol,
    name,
    address,
    status: asset.status ?? "UNKNOWN",
    ...((asset.logoUrl ?? asset.logo_url)
      ? { logoUrl: asset.logoUrl ?? asset.logo_url }
      : {}),
    tradable,
  };
}
