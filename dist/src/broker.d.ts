import { type Address, type PublicClient } from "viem";
import type { AppConfig } from "./config.js";
import { RobinhoodAssetRegistry } from "./robinhood-assets.js";
import type { BrokerIdentity, PortfolioPosition } from "./types.js";
export declare class BrokerService {
    readonly config: AppConfig;
    readonly assets: RobinhoodAssetRegistry;
    readonly publicClient: PublicClient;
    constructor(config: AppConfig, assets?: RobinhoodAssetRegistry, publicClient?: PublicClient);
    assertNetwork(): Promise<void>;
    identity(tokenId: bigint): Promise<BrokerIdentity>;
    portfolio(tokenId: bigint): Promise<{
        identity: BrokerIdentity;
        ethBalance: string;
        positions: PortfolioPosition[];
    }>;
    tokenBalance(wallet: Address, token: Address): Promise<bigint>;
    tokenDecimals(token: Address): Promise<number>;
}
