import type { TradePost } from "./types.js";
import type { XPublisher } from "./x.js";
export declare class TradeOutbox {
    private readonly path;
    private writeLock;
    constructor(path: string);
    enqueue(post: TradePost): Promise<void>;
    pending(): Promise<TradePost[]>;
    markPosted(id: string, postId: string): Promise<void>;
    markFailed(id: string, error: unknown): Promise<void>;
    flush(publisher: XPublisher): Promise<{
        posted: number;
        failed: number;
        remaining: number;
    }>;
    private read;
    private mutate;
}
