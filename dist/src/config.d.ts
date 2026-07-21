import "dotenv/config";
import { type Address, type Hex } from "viem";
export interface AppConfig {
    rpcUrl: string;
    nftAddress: Address;
    defaultTokenId?: bigint;
    uniswapApiKey?: string;
    ownerPrivateKey?: Hex;
    allowLiveTrading: boolean;
    maxTradeBps: number;
    xUserAccessToken?: string;
    requireXPost: boolean;
    xDryRun: boolean;
    outboxPath: string;
    postRetryIntervalMs: number;
}
export declare function loadConfig(env?: NodeJS.ProcessEnv): AppConfig;
export declare function resolveTokenId(config: AppConfig, tokenId?: number): bigint;
