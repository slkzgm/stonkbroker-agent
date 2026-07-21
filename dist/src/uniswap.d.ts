import { type Address } from "viem";
import type { QuoteEnvelope, TransactionRequest } from "./types.js";
interface ApprovalResponse {
    requestId: string;
    approval: TransactionRequest | null;
    cancel: TransactionRequest | null;
}
export declare class UniswapClient {
    private readonly apiKey;
    private readonly baseUrl;
    private readonly fetcher;
    constructor(apiKey: string, baseUrl?: string, fetcher?: typeof fetch);
    quote(input: {
        tokenIn: Address;
        tokenOut: Address;
        amount: bigint;
        swapper: Address;
        slippagePercent: number;
    }): Promise<QuoteEnvelope>;
    buildSwap(quote: QuoteEnvelope): Promise<TransactionRequest>;
    checkApproval(input: {
        wallet: Address;
        token: Address;
        tokenOut: Address;
        amount: bigint;
    }): Promise<ApprovalResponse>;
    private post;
}
export {};
