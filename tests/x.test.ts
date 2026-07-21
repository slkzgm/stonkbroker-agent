import { describe, expect, it } from "vitest";

import type { TradePost } from "../src/types.js";
import { formatTradePost } from "../src/x.js";

describe("formatTradePost", () => {
  it("creates a concise, verifiable post without multiple cashtags", () => {
    const trade: TradePost = {
      id: "trade-1",
      tokenId: "4444",
      wallet: "0x0000000000000000000000000000000000000001",
      tokenInSymbol: "AAPL",
      tokenOutSymbol: "NVDA",
      amountIn: "0.001234567890123456",
      amountOut: "0.001987654321098765",
      txHash: `0x${"ab".repeat(32)}`,
      explorerUrl: `https://robinhoodchain.blockscout.com/tx/0x${"ab".repeat(32)}`,
      confirmedAt: "2026-07-21T20:00:00.000Z",
      approvalTxHashes: [],
      attempts: 0,
    };

    const text = formatTradePost(trade);

    expect(Array.from(text).length).toBeLessThanOrEqual(280);
    expect(text).toContain("StonkBroker #4444");
    expect(text).toContain("0.001234 AAPL → 0.001987 NVDA");
    expect(text).toContain(trade.explorerUrl);
    expect(text.match(/\$[A-Z]+/g)).toBeNull();
  });
});
