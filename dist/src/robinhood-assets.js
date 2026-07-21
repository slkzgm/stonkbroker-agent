import { getAddress } from "viem";
import { CHAIN_ID, ROBINHOOD_ASSETS_URL } from "./constants.js";
export class RobinhoodAssetRegistry {
    url;
    cacheMs;
    fetcher;
    cache;
    constructor(url = ROBINHOOD_ASSETS_URL, cacheMs = 5 * 60_000, fetcher = fetch) {
        this.url = url;
        this.cacheMs = cacheMs;
        this.fetcher = fetcher;
    }
    async list(forceRefresh = false) {
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
        const payload = (await response.json());
        const assets = (payload.assets ?? [])
            .map(toAsset)
            .filter((asset) => asset !== undefined)
            .sort((left, right) => left.symbol.localeCompare(right.symbol));
        if (assets.length === 0) {
            throw new Error("Robinhood asset registry returned no mainnet assets");
        }
        this.cache = { assets, expiresAt: now + this.cacheMs };
        return assets;
    }
    async resolve(reference) {
        const assets = await this.list();
        const normalized = reference.toLowerCase();
        const matches = assets.filter((asset) => asset.symbol.toLowerCase() === normalized || asset.address.toLowerCase() === normalized);
        if (matches.length === 0) {
            throw new Error(`Unknown canonical Robinhood stock token: ${reference}`);
        }
        if (matches.length > 1) {
            throw new Error(`Ambiguous Robinhood token symbol: ${reference}; use a contract address`);
        }
        return matches[0];
    }
    async byAddress() {
        return new Map((await this.list()).map((asset) => [asset.address.toLowerCase(), asset]));
    }
}
function toAsset(asset) {
    const deployment = (asset.deployments ?? []).find((candidate) => (candidate.chainId ?? candidate.chain_id) === CHAIN_ID);
    const rawAddress = deployment?.contractAddress ?? deployment?.contract_address;
    const symbol = asset.tokenSymbol ?? asset.token_symbol;
    const name = asset.tokenName ?? asset.token_name;
    if (!rawAddress || !symbol || !name)
        return undefined;
    let address;
    try {
        address = getAddress(rawAddress);
    }
    catch {
        return undefined;
    }
    const market = asset.tradingCapabilities?.market;
    const tradable = [market?.whole, market?.fractional].some((status) => status === "TRADING_STATUS_TRADABLE");
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
//# sourceMappingURL=robinhood-assets.js.map