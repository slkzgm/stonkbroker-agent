import { type Address } from "viem";
export declare const CHAIN_ID = 4663;
export declare const DEFAULT_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export declare const BLOCKSCOUT_URL = "https://robinhoodchain.blockscout.com";
export declare const BLOCKSCOUT_API_URL = "https://robinhoodchain.blockscout.com/api/v2";
export declare const ROBINHOOD_ASSETS_URL = "https://api.robinhood.com/rhj/assets";
export declare const UNISWAP_API_URL = "https://trade-api.gateway.uniswap.org/v1";
export declare const X_API_URL = "https://api.x.com/2/tweets";
export declare const DEFAULT_STONKBROKER_NFT: `0x${string}`;
export declare const KNOWN_STONKBROKER_ACCOUNT_IMPLEMENTATION: `0x${string}`;
export declare const robinhoodChain: {
    blockExplorers: {
        readonly default: {
            readonly name: "Robinhood Chain Explorer";
            readonly url: "https://robinhoodchain.blockscout.com";
        };
    };
    blockTime?: number | undefined;
    contracts?: import("viem").Prettify<{
        [key: string]: import("viem").ChainContract | {
            [sourceId: number]: import("viem").ChainContract | undefined;
        } | undefined;
    } & {
        ensRegistry?: import("viem").ChainContract | undefined;
        ensUniversalResolver?: import("viem").ChainContract | undefined;
        multicall3?: import("viem").ChainContract | undefined;
        erc6492Verifier?: import("viem").ChainContract | undefined;
    }> | undefined;
    ensTlds?: readonly string[] | undefined;
    id: 4663;
    name: "Robinhood Chain";
    nativeCurrency: {
        readonly name: "Ether";
        readonly symbol: "ETH";
        readonly decimals: 18;
    };
    experimental_preconfirmationTime?: number | undefined;
    rpcUrls: {
        readonly default: {
            readonly http: readonly ["https://rpc.mainnet.chain.robinhood.com"];
        };
    };
    sourceId?: number | undefined;
    supportsTransactionReplacementDetection?: boolean | undefined;
    testnet?: boolean | undefined;
    custom?: Record<string, unknown> | undefined;
    extendSchema?: Record<string, unknown> | undefined;
    fees?: import("viem").ChainFees<undefined> | undefined;
    formatters?: undefined;
    prepareTransactionRequest?: ((args: import("viem").PrepareTransactionRequestParameters, options: {
        client: import("viem").Client;
        phase: "afterFillParameters" | "beforeFillParameters" | "beforeFillTransaction";
    }) => Promise<import("viem").PrepareTransactionRequestParameters>) | [fn: ((args: import("viem").PrepareTransactionRequestParameters, options: {
        client: import("viem").Client;
        phase: "afterFillParameters" | "beforeFillParameters" | "beforeFillTransaction";
    }) => Promise<import("viem").PrepareTransactionRequestParameters>) | undefined, options: {
        runAt: readonly ("afterFillParameters" | "beforeFillParameters" | "beforeFillTransaction")[];
    }] | undefined;
    serializers?: import("viem").ChainSerializers<undefined, import("viem").TransactionSerializable> | undefined;
    verifyHash?: ((client: import("viem").Client, parameters: import("viem").VerifyHashActionParameters) => Promise<import("viem").VerifyHashActionReturnType>) | undefined;
};
export declare const asAddress: (value: string) => Address;
