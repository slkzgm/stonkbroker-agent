import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  parseAbiParameters,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { erc20Abi, uniswapSwapProxyAbi } from "../src/abis.js";
import type { BrokerService } from "../src/broker.js";
import type { AppConfig } from "../src/config.js";
import {
  DEFAULT_STONKBROKER_NFT,
  UNISWAP_SWAP_PROXY,
  UNISWAP_UNIVERSAL_ROUTER,
} from "../src/constants.js";
import { TradeOutbox } from "../src/outbox.js";
import { StonkTrader } from "../src/trader.js";
import type { QuoteEnvelope, RobinhoodAsset, TransactionRequest } from "../src/types.js";
import type { UniswapClient } from "../src/uniswap.js";
import { XPublisher } from "../src/x.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("StonkTrader orchestration", () => {
  it("quotes, applies an exact allowance, executes once, persists, and posts the confirmed deltas", async () => {
    const privateKey = generatePrivateKey();
    const owner = getAddress(privateKeyToAccount(privateKey).address);
    const wallet = "0xAc8317E79598756bbF16E30EE8eb1e045Cc20b0e" as Address;
    const tokenIn = asset("AAPL", "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9");
    const tokenOut = asset("NVDA", "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC");
    let inputBalance = 1_000n;
    let outputBalance = 0n;
    let allowance = 0n;

    const broker = {
      identity: vi.fn().mockResolvedValue({
        tokenId: 1n,
        nftAddress: DEFAULT_STONKBROKER_NFT,
        owner,
        wallet,
        accountImplementation: "0xE946075125843aAdb5e40e59f513d929AF507C4B",
        fundedToken: tokenIn.address,
        initialWalletGrant: 1_000n,
      }),
      assets: {
        resolve: vi.fn(async (reference: string) =>
          reference.toUpperCase() === "AAPL" ? tokenIn : tokenOut,
        ),
      },
      assertInfrastructure: vi.fn().mockResolvedValue(undefined),
      tokenDecimals: vi.fn().mockResolvedValue(0),
      tokenBalance: vi.fn(async (_wallet: Address, token: Address) =>
        getAddress(token) === tokenIn.address ? inputBalance : outputBalance,
      ),
      nativeBalance: vi.fn().mockResolvedValue(1_000_000_000_000_000n),
      tokenAllowance: vi.fn(async () => allowance),
    } as unknown as BrokerService;

    const quoteEnvelope: QuoteEnvelope = {
      requestId: "request-1",
      routing: "CLASSIC",
      quote: {
        input: { amount: "100", token: tokenIn.address },
        output: { amount: "125", token: tokenOut.address, recipient: wallet },
      },
      permitData: null,
    };
    const swapTransaction = (): TransactionRequest => ({
      from: wallet,
      to: UNISWAP_SWAP_PROXY,
      chainId: 4663,
      value: "0",
      data: encodeFunctionData({
        abi: uniswapSwapProxyAbi,
        functionName: "execute",
        args: [
          UNISWAP_UNIVERSAL_ROUTER,
          tokenIn.address,
          100n,
          "0x00",
          [
            encodeAbiParameters(
              parseAbiParameters(
                "address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser, uint256[] minHopPriceX36",
              ),
              [
                wallet,
                100n,
                1n,
                `${tokenIn.address}000bb8${tokenOut.address.slice(2)}` as Hex,
                false,
                [],
              ],
            ),
          ],
          BigInt(Math.floor(Date.now() / 1_000) + 120),
        ],
      }),
    });
    const uniswap = {
      quote: vi.fn().mockResolvedValue(quoteEnvelope),
      buildSwap: vi.fn(async () => swapTransaction()),
    } as unknown as UniswapClient;

    const directory = await mkdtemp(join(tmpdir(), "stonkagent-trader-"));
    temporaryDirectories.push(directory);
    const outbox = new TradeOutbox(join(directory, "outbox.json"));
    const xFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "123", username: "stonk-agent" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "2079000000000000000" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
    const publisher = new XPublisher(
      "x-user-token",
      false,
      xFetcher,
    );
    const executor = vi.fn(
      async (transaction: TransactionRequest): Promise<Hash> => {
        if (getAddress(transaction.to) === tokenIn.address) {
          const decoded = decodeFunctionData({ abi: erc20Abi, data: transaction.data });
          if (decoded.functionName !== "approve") throw new Error("unexpected token call");
          allowance = decoded.args[1];
          return `0x${"aa".repeat(32)}`;
        }
        inputBalance = 900n;
        outputBalance = 125n;
        allowance = 0n;
        return `0x${"bb".repeat(32)}`;
      },
    );
    const trader = new StonkTrader(
      config(privateKey, directory),
      broker,
      uniswap,
      outbox,
      publisher,
      executor,
    );

    const quote = await trader.quoteTrade({
      tokenId: 1n,
      tokenIn: "AAPL",
      tokenOut: "NVDA",
      amount: "100",
      slippagePercent: 0.5,
    });
    const result = await trader.executeTrade(quote.id);

    expect(result.postStatus).toBe("posted");
    expect(result.xPostId).toBe("2079000000000000000");
    expect(result.trade.amountIn).toBe("100");
    expect(result.trade.amountOut).toBe("125");
    expect(result.trade.txHash).toBe(`0x${"bb".repeat(32)}`);
    expect(result.trade.approvalTxHashes).toEqual([`0x${"aa".repeat(32)}`]);
    expect(executor).toHaveBeenCalledTimes(2);
    expect(xFetcher).toHaveBeenCalledTimes(2);
    await expect(trader.executeTrade(quote.id)).rejects.toThrow("Unknown quoteId");
    await expect(outbox.pending()).resolves.toEqual([]);
  });
});

function asset(symbol: string, address: Address): RobinhoodAsset {
  return {
    id: symbol.toLowerCase(),
    symbol,
    name: `${symbol} Robinhood Token`,
    address: getAddress(address),
    status: "ASSET_STATUS_ACTIVE",
    tradable: true,
  };
}

function config(privateKey: Hex, directory: string): AppConfig {
  return {
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    nftAddress: DEFAULT_STONKBROKER_NFT,
    defaultTokenId: 1n,
    uniswapApiKey: "uniswap-key",
    ownerPrivateKey: privateKey,
    allowLiveTrading: true,
    maxTradeBps: 2_500,
    xUserAccessToken: "x-user-token",
    requireXPost: true,
    xDryRun: false,
    outboxPath: join(directory, "outbox.json"),
    postRetryIntervalMs: 60_000,
  };
}
