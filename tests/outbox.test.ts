import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { TradeOutbox } from "../src/outbox.js";
import type { TradePost } from "../src/types.js";
import { XPublisher } from "../src/x.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("TradeOutbox", () => {
  it("persists first, posts, then records the X post id", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stonkagent-outbox-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "outbox.json");
    const outbox = new TradeOutbox(path);
    const trade = exampleTrade();
    await outbox.enqueue(trade);

    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "2079000000000000000", text: "ok" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    const publisher = new XPublisher("user-token", false, fetcher);
    const result = await outbox.flush(publisher);

    expect(result).toEqual({ posted: 1, failed: 0, remaining: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(await readFile(path, "utf8")) as {
      posts: Array<{ xPostId?: string; postedAt?: string }>;
    };
    expect(stored.posts[0]?.xPostId).toBe("2079000000000000000");
    expect(stored.posts[0]?.postedAt).toBeTruthy();
  });
});

function exampleTrade(): TradePost {
  return {
    id: "trade-1",
    tokenId: "1",
    wallet: "0x0000000000000000000000000000000000000001",
    tokenInSymbol: "AAPL",
    tokenOutSymbol: "AMZN",
    amountIn: "0.001",
    amountOut: "0.0012",
    txHash: `0x${"cd".repeat(32)}`,
    explorerUrl: `https://robinhoodchain.blockscout.com/tx/0x${"cd".repeat(32)}`,
    confirmedAt: "2026-07-21T20:00:00.000Z",
    approvalTxHashes: [],
    attempts: 0,
  };
}
