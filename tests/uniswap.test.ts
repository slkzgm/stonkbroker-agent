import type { Address } from "viem";
import { describe, expect, it, vi } from "vitest";

import { UNISWAP_UNIVERSAL_ROUTER_VERSION } from "../src/constants.js";
import type { QuoteEnvelope } from "../src/types.js";
import { UniswapClient, validateQuoteEnvelope } from "../src/uniswap.js";

const tokenIn = "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" as Address;
const tokenOut = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" as Address;
const wallet = "0xAc8317E79598756bbF16E30EE8eb1e045Cc20b0e" as Address;

describe("UniswapClient", () => {
  it("pins Universal Router 2.1.1 and validates the complete quote binding", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(quoteEnvelope()),
    );
    const client = new UniswapClient("test-key", "https://example.test/v1", fetcher);

    const quote = await client.quote({
      tokenIn,
      tokenOut,
      amount: 100n,
      swapper: wallet,
      slippagePercent: 0.5,
    });

    expect(quote.quote.output?.amount).toBe("125");
    const [, init] = fetcher.mock.calls[0]!;
    expect(init?.headers).toMatchObject({
      "x-universal-router-version": UNISWAP_UNIVERSAL_ROUTER_VERSION,
      "x-permit2-disabled": "true",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      tokenIn,
      tokenOut,
      amount: "100",
      tokenInChainId: 4663,
      tokenOutChainId: 4663,
      swapper: wallet,
      recipient: wallet,
      protocols: ["V2", "V3", "V4"],
    });
  });

  it("rejects a quote that redirects output or changes the requested amount", () => {
    const redirected = quoteEnvelope();
    redirected.quote.output!.recipient =
      "0x0000000000000000000000000000000000000004";
    expect(() =>
      validateQuoteEnvelope(redirected, { tokenIn, tokenOut, amount: 100n, swapper: wallet }),
    ).toThrow("recipient");

    const wrongAmount = quoteEnvelope();
    wrongAmount.quote.input!.amount = "101";
    expect(() =>
      validateQuoteEnvelope(wrongAmount, { tokenIn, tokenOut, amount: 100n, swapper: wallet }),
    ).toThrow("input amount");
  });
});

function quoteEnvelope(): QuoteEnvelope {
  return {
    requestId: "request-1",
    routing: "CLASSIC",
    quote: {
      input: { amount: "100", token: tokenIn },
      output: { amount: "125", token: tokenOut, recipient: wallet },
    },
    permitData: null,
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
