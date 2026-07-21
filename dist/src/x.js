import { X_API_URL } from "./constants.js";
export class XPublisher {
    userAccessToken;
    dryRun;
    fetcher;
    constructor(userAccessToken, dryRun = false, fetcher = fetch) {
        this.userAccessToken = userAccessToken;
        this.dryRun = dryRun;
        this.fetcher = fetcher;
    }
    get configured() {
        return this.dryRun || Boolean(this.userAccessToken);
    }
    async publish(trade) {
        const text = formatTradePost(trade);
        if (this.dryRun) {
            return { postId: `dry-run:${trade.txHash}`, text, dryRun: true };
        }
        if (!this.userAccessToken) {
            throw new Error("X_USER_ACCESS_TOKEN is not configured");
        }
        const response = await this.fetcher(X_API_URL, {
            method: "POST",
            headers: {
                authorization: `Bearer ${this.userAccessToken}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({ text, made_with_ai: true }),
            signal: AbortSignal.timeout(15_000),
        });
        const payload = (await response.json());
        const postId = payload.data?.id;
        if (!response.ok || !postId) {
            throw new Error(`X API returned HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
        }
        return { postId, text, dryRun: false };
    }
}
export function formatTradePost(trade) {
    const text = [
        `🤖 StonkBroker #${trade.tokenId} traded ${compactAmount(trade.amountIn)} ${trade.tokenInSymbol} → ${compactAmount(trade.amountOut)} ${trade.tokenOutSymbol} on Robinhood Chain.`,
        "",
        `Tx: ${trade.explorerUrl}`,
        "",
        "#StonkBrokers",
    ].join("\n");
    if (Array.from(text).length > 280) {
        throw new Error("Generated X post exceeds 280 characters");
    }
    return text;
}
function compactAmount(value) {
    const [whole = "0", fraction = ""] = value.split(".");
    const trimmed = fraction.slice(0, 6).replace(/0+$/, "");
    return trimmed ? `${whole}.${trimmed}` : whole;
}
//# sourceMappingURL=x.js.map