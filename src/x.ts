import { X_API_URL, X_API_USER_ME_URL } from "./constants.js";
import type { TradePost } from "./types.js";

interface XCreatePostResponse {
  data?: { id?: string; text?: string };
  errors?: unknown;
}

interface XUserMeResponse {
  data?: { id?: string; username?: string };
  errors?: unknown;
}

export interface PublishResult {
  postId: string;
  text: string;
  dryRun: boolean;
}

export class XPublisher {
  constructor(
    private readonly userAccessToken?: string,
    private readonly dryRun = false,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  get configured(): boolean {
    return this.dryRun || Boolean(this.userAccessToken);
  }

  async verifyCredentials(): Promise<{ id: string; username?: string; dryRun: boolean }> {
    if (this.dryRun) return { id: "dry-run", dryRun: true };
    if (!this.userAccessToken) throw new Error("X_USER_ACCESS_TOKEN is not configured");

    const response = await this.fetcher(X_API_USER_ME_URL, {
      headers: { authorization: `Bearer ${this.userAccessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json()) as XUserMeResponse;
    const id = payload.data?.id;
    if (!response.ok || !id) {
      throw new Error(
        `X credential check returned HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`,
      );
    }
    return {
      id,
      ...(payload.data?.username ? { username: payload.data.username } : {}),
      dryRun: false,
    };
  }

  async publish(trade: TradePost): Promise<PublishResult> {
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
    const payload = (await response.json()) as XCreatePostResponse;
    const postId = payload.data?.id;
    if (!response.ok || !postId) {
      throw new Error(
        `X API returned HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`,
      );
    }
    return { postId, text, dryRun: false };
  }
}

export function formatTradePost(trade: TradePost): string {
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

function compactAmount(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const trimmed = fraction.slice(0, 6).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}
