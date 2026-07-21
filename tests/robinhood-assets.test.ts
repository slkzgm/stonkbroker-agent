import { describe, expect, it, vi } from "vitest";

import { RobinhoodAssetRegistry } from "../src/robinhood-assets.js";

describe("RobinhoodAssetRegistry", () => {
  it("keeps only canonical Robinhood Chain deployments and resolves symbols", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          assets: [
            {
              id: "aapl-id",
              tokenSymbol: "AAPL",
              tokenName: "Apple • Robinhood Token",
              deployments: [
                {
                  contractAddress: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
                  chainId: 4663,
                },
              ],
              status: "ASSET_STATUS_ACTIVE",
              tradingCapabilities: {
                market: { fractional: "TRADING_STATUS_TRADABLE" },
              },
            },
            {
              id: "wrong-chain",
              tokenSymbol: "FAKE",
              tokenName: "Wrong chain",
              deployments: [
                {
                  contractAddress: "0x0000000000000000000000000000000000000001",
                  chainId: 1,
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const registry = new RobinhoodAssetRegistry("https://example.test/assets", 60_000, fetcher);

    const assets = await registry.list();

    expect(assets).toHaveLength(1);
    expect((await registry.resolve("aapl")).symbol).toBe("AAPL");
    expect((await registry.resolve(assets[0]!.address)).name).toContain("Apple");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
