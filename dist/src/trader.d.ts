import { type Address, type Hash } from "viem";
import { BrokerService } from "./broker.js";
import type { AppConfig } from "./config.js";
import { TradeOutbox } from "./outbox.js";
import type { StoredQuote, TradePost, TransactionRequest } from "./types.js";
import { UniswapClient } from "./uniswap.js";
import { XPublisher } from "./x.js";
export declare class StonkTrader {
    readonly config: AppConfig;
    readonly broker: BrokerService;
    private readonly uniswap?;
    private readonly transactionExecutor?;
    private readonly quotes;
    private readonly outbox;
    private readonly publisher;
    constructor(config: AppConfig, broker: BrokerService, uniswap?: UniswapClient | undefined, outbox?: TradeOutbox, publisher?: XPublisher, transactionExecutor?: ((transaction: TransactionRequest, wallet: Address, owner: Address) => Promise<Hash>) | undefined);
    quoteTrade(input: {
        tokenId: bigint;
        tokenIn: string;
        tokenOut: string;
        amount: string;
        slippagePercent: number;
    }): Promise<StoredQuote>;
    executeTrade(quoteId: string): Promise<{
        trade: TradePost;
        postStatus: "posted" | "pending";
        xPostId?: string;
    }>;
    flushPendingPosts(): Promise<{
        posted: number;
        failed: number;
        remaining: number;
    }>;
    private executeTbaCall;
    private requireUniswap;
    private assertLiveTradingReady;
    private pruneQuotes;
}
export declare function validateSwapTransaction(transaction: TransactionRequest, wallet: Address, tokenIn: Address, tokenOut: Address, exactAmountIn: bigint, nowSeconds?: bigint): void;
export declare function validateApprovalTransaction(transaction: TransactionRequest, wallet: Address, tokenIn: Address, swapTarget: Address, exactApprovalAmount: bigint): void;
export declare function requiredApprovalAmounts(currentAllowance: bigint, exactAmountIn: bigint): bigint[];
