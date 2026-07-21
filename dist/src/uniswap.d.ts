import { type Address } from "viem";
import type { QuoteEnvelope, TransactionRequest } from "./types.js";
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
    private post;
}
export declare function validateQuoteEnvelope(envelope: QuoteEnvelope, expected: {
    tokenIn: Address;
    tokenOut: Address;
    amount: bigint;
    swapper: Address;
}): QuoteEnvelope;
