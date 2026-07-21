import type { RobinhoodAsset } from "./types.js";
export declare class RobinhoodAssetRegistry {
    private readonly url;
    private readonly cacheMs;
    private readonly fetcher;
    private cache?;
    constructor(url?: string, cacheMs?: number, fetcher?: typeof fetch);
    list(forceRefresh?: boolean): Promise<RobinhoodAsset[]>;
    resolve(reference: string): Promise<RobinhoodAsset>;
    byAddress(): Promise<Map<string, RobinhoodAsset>>;
}
