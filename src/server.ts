#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { formatUnits } from "viem";
import * as z from "zod/v4";

import { BrokerService } from "./broker.js";
import { loadConfig, resolveTokenId } from "./config.js";
import {
  UNISWAP_SWAP_PROXY,
  UNISWAP_UNIVERSAL_ROUTER,
  UNISWAP_UNIVERSAL_ROUTER_VERSION,
} from "./constants.js";
import { StonkTrader } from "./trader.js";
import { UniswapClient } from "./uniswap.js";

const config = loadConfig();
const broker = new BrokerService(config);
const uniswap = config.uniswapApiKey ? new UniswapClient(config.uniswapApiKey) : undefined;
const trader = new StonkTrader(config, broker, uniswap);

const server = new McpServer({
  name: "stonkbroker-agent",
  version: "0.2.0",
});

server.registerTool(
  "system_health",
  {
    description:
      "Check Robinhood Chain connectivity and whether quote, signing, live trading, and X posting credentials are configured. Never returns secrets.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async () =>
    toolResult(async () => {
      await broker.assertInfrastructure();
      return {
        chainId: 4663,
        rpcConnected: true,
        nftAddress: config.nftAddress,
        defaultTokenId: config.defaultTokenId?.toString() ?? null,
        quoteApiConfigured: Boolean(config.uniswapApiKey),
        ownerSignerConfigured: Boolean(config.ownerPrivateKey),
        liveTradingEnabled: config.allowLiveTrading,
        xPostingConfigured: Boolean(config.xUserAccessToken),
        xDryRun: config.xDryRun,
        requireXPost: config.requireXPost,
        maxTradeBps: config.maxTradeBps,
        uniswapUniversalRouterVersion: UNISWAP_UNIVERSAL_ROUTER_VERSION,
        uniswapUniversalRouter: UNISWAP_UNIVERSAL_ROUTER,
        uniswapSwapProxy: UNISWAP_SWAP_PROXY,
      };
    }),
);

server.registerTool(
  "broker_status",
  {
    description:
      "Inspect a StonkBroker NFT, verify its ERC-6551 binding, and list canonical Robinhood stock-token balances in its token-bound wallet.",
    inputSchema: {
      tokenId: z.number().int().positive().optional().describe("StonkBroker token ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async ({ tokenId }) =>
    toolResult(async () => {
      const result = await broker.portfolio(resolveTokenId(config, tokenId));
      return {
        tokenId: result.identity.tokenId.toString(),
        nftAddress: result.identity.nftAddress,
        owner: result.identity.owner,
        tokenBoundWallet: result.identity.wallet,
        accountImplementation: result.identity.accountImplementation,
        fundedToken: result.identity.fundedToken,
        initialWalletGrantRaw: result.identity.initialWalletGrant.toString(),
        ethBalance: result.ethBalance,
        positions: result.positions.map((position) => ({
          symbol: position.asset.symbol,
          name: position.asset.name,
          address: position.asset.address,
          balance: position.formattedBalance,
          rawBalance: position.rawBalance.toString(),
          ...(position.exchangeRateUsd
            ? { referencePriceUsd: position.exchangeRateUsd }
            : {}),
        })),
      };
    }),
);

server.registerTool(
  "list_stock_tokens",
  {
    description:
      "List canonical stock tokens from Robinhood's live asset registry. Use a symbol or contract substring to filter results.",
    inputSchema: {
      query: z.string().trim().optional(),
      limit: z.number().int().min(1).max(100).default(25),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async ({ query, limit }) =>
    toolResult(async () => {
      const normalized = query?.toLowerCase();
      const assets = (await broker.assets.list())
        .filter(
          (asset) =>
            !normalized ||
            asset.symbol.toLowerCase().includes(normalized) ||
            asset.name.toLowerCase().includes(normalized) ||
            asset.address.toLowerCase().includes(normalized),
        )
        .slice(0, limit);
      return assets;
    }),
);

server.registerTool(
  "quote_stock_trade",
  {
    description:
      "Request a time-limited Uniswap quote for an exact-input trade between canonical Robinhood stock tokens held by a StonkBroker TBA. This never signs or submits a transaction.",
    inputSchema: {
      tokenId: z.number().int().positive().optional(),
      tokenIn: z.string().min(1).describe("Canonical token symbol or contract address"),
      tokenOut: z.string().min(1).describe("Canonical token symbol or contract address"),
      amount: z.string().regex(/^\d+(\.\d+)?$/).describe("Human-readable input amount"),
      slippagePercent: z.number().min(0.01).max(5).default(0.5),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
  },
  async ({ tokenId, tokenIn, tokenOut, amount, slippagePercent }) =>
    toolResult(async () => {
      const quote = await trader.quoteTrade({
        tokenId: resolveTokenId(config, tokenId),
        tokenIn,
        tokenOut,
        amount,
        slippagePercent,
      });
      return {
        quoteId: quote.id,
        expiresAt: new Date(quote.expiresAt).toISOString(),
        tokenId: quote.tokenId.toString(),
        tokenBoundWallet: quote.wallet,
        input: {
          symbol: quote.tokenIn.symbol,
          address: quote.tokenIn.address,
          amount: quote.amountIn.toString(),
          formattedAmount: amount,
        },
        output: {
          symbol: quote.tokenOut.symbol,
          address: quote.tokenOut.address,
          quotedAmount: quote.quotedAmountOut.toString(),
          formattedQuotedAmount: formatUnits(quote.quotedAmountOut, quote.tokenOutDecimals),
        },
        slippagePercent: quote.slippagePercent,
        route: quote.envelope.routing,
        nextStep:
          "Call execute_stock_trade with this quoteId and confirmation=EXECUTE before the quote expires.",
      };
    }),
);

server.registerTool(
  "execute_stock_trade",
  {
    description:
      "Execute a previously quoted trade from the StonkBroker ERC-6551 wallet, wait for confirmation, then automatically post the actual balance deltas and transaction link to X.",
    inputSchema: {
      quoteId: z.uuid(),
      confirmation: z.literal("EXECUTE"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  },
  async ({ quoteId }) => toolResult(() => trader.executeTrade(quoteId)),
);

server.registerTool(
  "retry_x_posts",
  {
    description:
      "Retry every queued X post for confirmed trades. Confirmed trades are durably queued before the first posting attempt.",
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async () => toolResult(() => trader.flushPendingPosts()),
);

async function toolResult(action: () => Promise<unknown>) {
  try {
    return {
      content: [{ type: "text" as const, text: json(await action()) }],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: json({ error: error instanceof Error ? error.message : String(error) }),
        },
      ],
      isError: true,
    };
  }
}

function json(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );
}

let retrying = false;
const retryTimer = setInterval(() => {
  if (retrying || !config.xUserAccessToken || config.xDryRun) return;
  retrying = true;
  void trader
    .flushPendingPosts()
    .catch((error) => console.error("X outbox retry failed:", error))
    .finally(() => {
      retrying = false;
    });
}, config.postRetryIntervalMs);
retryTimer.unref();

process.on("SIGINT", async () => {
  clearInterval(retryTimer);
  await server.close();
  process.exit(0);
});

const transport = new StdioServerTransport();
await server.connect(transport);
