#!/usr/bin/env node
import { formatUnits } from "viem";
import { BrokerService } from "./broker.js";
import { loadConfig, resolveTokenId } from "./config.js";
import { StonkTrader } from "./trader.js";
import { UniswapClient } from "./uniswap.js";
const config = loadConfig();
const broker = new BrokerService(config);
const trader = new StonkTrader(config, broker, config.uniswapApiKey ? new UniswapClient(config.uniswapApiKey) : undefined);
const [command = "help", ...args] = process.argv.slice(2);
const flags = parseFlags(args);
switch (command) {
    case "status": {
        const result = await broker.portfolio(tokenIdFlag(flags));
        print({
            ...result,
            identity: {
                ...result.identity,
                tokenId: result.identity.tokenId.toString(),
                initialWalletGrant: result.identity.initialWalletGrant.toString(),
            },
        });
        break;
    }
    case "tokens": {
        const query = flags.get("query")?.toLowerCase();
        const assets = (await broker.assets.list()).filter((asset) => !query ||
            asset.symbol.toLowerCase().includes(query) ||
            asset.name.toLowerCase().includes(query));
        print(assets);
        break;
    }
    case "quote": {
        const quote = await trader.quoteTrade({
            tokenId: tokenIdFlag(flags),
            tokenIn: required(flags, "in"),
            tokenOut: required(flags, "out"),
            amount: required(flags, "amount"),
            slippagePercent: Number(flags.get("slippage") ?? "0.5"),
        });
        print({
            quoteId: quote.id,
            expiresAt: new Date(quote.expiresAt).toISOString(),
            input: `${formatUnits(quote.amountIn, quote.tokenInDecimals)} ${quote.tokenIn.symbol}`,
            quotedOutput: `${formatUnits(quote.quotedAmountOut, quote.tokenOutDecimals)} ${quote.tokenOut.symbol}`,
            route: quote.envelope.routing,
        });
        break;
    }
    case "retry-posts":
        print(await trader.flushPendingPosts());
        break;
    default:
        process.stderr.write([
            "Usage:",
            "  stonkbroker-cli status [--token-id 1]",
            "  stonkbroker-cli tokens [--query AAPL]",
            "  stonkbroker-cli quote --token-id 1 --in AAPL --out AMZN --amount 0.001 [--slippage 0.5]",
            "  stonkbroker-cli retry-posts",
            "",
            "Live execution is intentionally exposed through the two-step MCP flow.",
        ].join("\n") + "\n");
        process.exitCode = command === "help" ? 0 : 1;
}
function parseFlags(args) {
    const parsed = new Map();
    for (let index = 0; index < args.length; index += 2) {
        const flag = args[index];
        const value = args[index + 1];
        if (!flag?.startsWith("--") || value === undefined) {
            throw new Error(`Invalid flag near ${flag ?? "end of command"}`);
        }
        parsed.set(flag.slice(2), value);
    }
    return parsed;
}
function required(flags, name) {
    const value = flags.get(name);
    if (!value)
        throw new Error(`--${name} is required`);
    return value;
}
function tokenIdFlag(flags) {
    const value = flags.get("token-id");
    return resolveTokenId(config, value ? Number(value) : undefined);
}
function print(value) {
    process.stdout.write(`${JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item), 2)}\n`);
}
//# sourceMappingURL=cli.js.map