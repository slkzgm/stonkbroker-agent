import type { TradePost } from "./types.js";
export interface PublishResult {
    postId: string;
    text: string;
    dryRun: boolean;
}
export declare class XPublisher {
    private readonly userAccessToken?;
    private readonly dryRun;
    private readonly fetcher;
    constructor(userAccessToken?: string | undefined, dryRun?: boolean, fetcher?: typeof fetch);
    get configured(): boolean;
    verifyCredentials(): Promise<{
        id: string;
        username?: string;
        dryRun: boolean;
    }>;
    publish(trade: TradePost): Promise<PublishResult>;
}
export declare function formatTradePost(trade: TradePost): string;
