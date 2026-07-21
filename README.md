# StonkBroker Agent

[![CI](https://github.com/slkzgm/stonkbroker-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/slkzgm/stonkbroker-agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

An MCP server that gives an AI agent controlled access to a StonkBroker NFT's ERC-6551 token-bound wallet (TBA). The agent can inspect the wallet, quote a stock-token swap, execute it on Robinhood Chain through Uniswap, and automatically publish the confirmed trade to X.

This is independent, experimental software and is not affiliated with or
endorsed by Robinhood, StonkBrokers, Uniswap, or X. Stock tokens and automated
trading involve financial risk; start in read-only mode.

The implementation targets the canonical mainnet contracts and APIs that are live today:

- Robinhood Chain: chain ID `4663`
- StonkBrokers NFT: `0x539CdD042c2f3d93EbC5BE7DfFf0c79F3B4fAbF0`
- Verified TBA implementation: `0xE946075125843aAdb5e40e59f513d929AF507C4B`
- Canonical stock-token registry: `https://api.robinhood.com/rhj/assets`
- Uniswap Trading API: classic V2/V3/V4 routes on chain `4663`
- X API: `POST /2/tweets` with OAuth user context

## How it works

```text
AI agent
   │ MCP tools
   ▼
quote_stock_trade ──► Robinhood canonical asset registry
   │                  Uniswap Trading API (quote only)
   ▼
execute_stock_trade (explicit confirmation + live-trading gate)
   │
   ├─ verify NFT owner ↔ TBA binding
   ├─ enforce exact token approval and MAX_TRADE_BPS
   ├─ owner EOA calls TBA.executeCall(token.approve)
   ├─ owner EOA calls TBA.executeCall(Uniswap swap)
   ├─ wait for a successful Robinhood Chain receipt
   ├─ measure actual input/output balance deltas
   └─ persist trade in outbox ──► X API post + automatic retries
```

The agent never trades from the owner's EOA. The TBA is the swapper and recipient; the EOA only authorizes `executeCall` because it currently owns the NFT and pays network gas.

## Quick start

Any MCP client that can launch a stdio server can run the latest public source
directly from GitHub—no clone or global installation required:

```json
{
  "mcpServers": {
    "stonkbroker": {
      "command": "npx",
      "args": ["--yes", "github:slkzgm/stonkbroker-agent"],
      "env": {
        "BROKER_TOKEN_ID": "1"
      }
    }
  }
}
```

Restart the MCP client, then ask: `Inspect StonkBroker #1 and show its stock-token portfolio.`

The default configuration is read-only: it uses the public Robinhood Chain RPC,
does not need a wallet key, and cannot trade. See [Enable live trading](#enable-live-trading)
only when you are ready to perform the bounty proof with a low-value wallet.

## MCP tools

| Tool | Effect |
| --- | --- |
| `system_health` | Read-only connectivity and configuration check; never reveals secrets. |
| `broker_status` | Verifies the ERC-6551 binding and lists canonical Robinhood stock-token balances. |
| `list_stock_tokens` | Searches Robinhood's live canonical asset registry. |
| `quote_stock_trade` | Returns a 30-second exact-input Uniswap quote. No signing or transaction. |
| `execute_stock_trade` | Requires `confirmation: "EXECUTE"`, submits the TBA calls, and queues/posts the trade to X. |
| `retry_x_posts` | Retries queued X posts for confirmed swaps. |

## Install from source

Requirements: Node.js 20+ and pnpm.

```bash
git clone https://github.com/slkzgm/stonkbroker-agent.git
cd stonkbroker-agent
corepack enable
pnpm install
cp .env.example .env
pnpm run build
pnpm run verify:chain
```

Read-only inspection works with the default public RPC and no secrets:

```bash
pnpm run cli -- status --token-id 1
pnpm run cli -- tokens --query AAPL
```

The packaged CLI can also be used without cloning:

```bash
npx --yes --package=github:slkzgm/stonkbroker-agent stonkbroker-cli status --token-id 1

# Equivalent pnpm command
pnpm dlx --package=github:slkzgm/stonkbroker-agent stonkbroker-cli status --token-id 1
```

## Enable live trading

To request quotes, set `UNISWAP_API_KEY`. To execute a trade, also set the
following values in a local `.env` file or your MCP client's private environment:

```dotenv
BROKER_TOKEN_ID=<your broker id>
OWNER_PRIVATE_KEY=0x...
ALLOW_LIVE_TRADING=true
X_USER_ACCESS_TOKEN=<OAuth user token with tweet.read tweet.write users.read>
REQUIRE_X_POST=true
X_DRY_RUN=false
```

The signer must be the current onchain owner of the selected StonkBroker. It also needs a small amount of ETH on Robinhood Chain for gas. Never put a key in source code or an MCP prompt.

## Connect an agent

For a local clone, build first and configure any MCP client to spawn the server
over stdio:

```json
{
  "mcpServers": {
    "stonkbroker": {
      "command": "node",
      "args": ["/absolute/path/to/stonkbroker/dist/src/server.js"],
      "env": {
        "BROKER_TOKEN_ID": "123",
        "UNISWAP_API_KEY": "...",
        "OWNER_PRIVATE_KEY": "0x...",
        "ALLOW_LIVE_TRADING": "true",
        "X_USER_ACCESS_TOKEN": "..."
      }
    }
  }
}
```

For Docker, build the image and keep stdin open for the MCP transport:

```bash
docker build -t stonkbroker-agent .
mkdir -p .stonkagent
docker run --rm -i --env-file .env \
  -v "$PWD/.stonkagent:/data" stonkbroker-agent
```

Suggested demo conversation:

1. `Inspect StonkBroker #123 and show its stock-token portfolio.`
2. `Quote swapping 0.001 AAPL to NVDA with 0.5% slippage.`
3. Review the route, amounts, expiry, and wallet returned by the agent.
4. `Execute quote <id> with confirmation EXECUTE.`
5. Open the returned Blockscout transaction and X post.

## Safety properties

- Live trading is off by default.
- A quote cannot spend more than `MAX_TRADE_BPS` of the current input-token balance (5% by default).
- Only canonical contracts returned by Robinhood's live registry can be selected.
- Quotes are forced to immediate Uniswap AMM routes; intent orders are not used.
- Permit2 is disabled. Any mismatched existing allowance is first cleared, then set to the exact input amount for Uniswap's deterministic Swap Proxy.
- The NFT owner, predicted TBA, deployed TBA, implementation, TBA owner, token contract, and token ID are checked before trading.
- Quote input, output, amount, and recipient must exactly match the request.
- Swap calldata must identify the TBA as `from`, target chain `4663`, call only the official Swap Proxy and Universal Router `2.1.1`, bind the exact input token and amount, send zero native value, use a short deadline, and survive an `eth_call` simulation through `executeCall`.
- V2, V3, nested, and V4 router plans are decoded: Permit2-funded, allow-revert, exact-output, partial-output, and unrelated commands are rejected, and the complete output must be addressed explicitly to the TBA rather than the Swap Proxy.
- A quote expires after 30 seconds and is removed after one execution attempt.
- Actual post amounts come from confirmed onchain balance deltas, not the pre-trade quote.
- Confirmed trades enter a mode-`0600` durable outbox before the first X request. Failed posts are retried every minute and through `retry_x_posts`.
- When `REQUIRE_X_POST=true`, live trading refuses to start without a real X user token or while X dry-run mode is enabled.

## Verification

```bash
pnpm run check
pnpm run test
pnpm run build
pnpm run verify:chain
```

`verify:chain` performs live read-only checks against chain `4663`, including the NFT/TBA linkage, canonical stock-token balances, Universal Router `2.1.1`, and Swap Proxy deployments. The test suite covers canonical-asset filtering, quote binding, decoded V2/V3/V4 calldata safety, complete trade orchestration, X post formatting, and outbox persistence.

## Robinhood Trading MCP and onchain execution

[Robinhood's Agentic Trading documentation](https://robinhood.com/us/en/support/articles/agentic-trading-overview/)
describes the Robinhood Trading MCP as connecting an AI agent to a dedicated
Robinhood Agentic brokerage account, and explicitly says the agent can only
place trades in that Agentic account. Separately, [Robinhood's Chain
documentation](https://robinhood.com/us/en/support/articles/robinhood-chain-mainnet/)
says Robinhood Chain operates independently of Robinhood brokerage and crypto
accounts.

The bounty targets a StonkBroker's ERC-6551 wallet on Robinhood Chain, so this
project provides a separate MCP execution path for that onchain account. The
current NFT owner authorizes the TBA call, and this implementation chooses
Uniswap as its swap venue. Uniswap is an implementation choice, not a claim
that it is the only possible onchain venue.

An agent may connect to both MCP servers: Robinhood Trading MCP for the
brokerage capabilities Robinhood documents, and this server for the
StonkBroker TBA. Based on the currently published interfaces, Robinhood Trading
MCP alone is not an execution interface for the TBA. See the
[architecture evidence and claim boundaries](docs/ARCHITECTURE.md).

## External prerequisites for a public bounty demo

The implementation and test harness contain no embedded credentials. The bounty
must not be claimed as verified until a public live proof provides:

1. A StonkBroker controlled by the demo signer.
2. Input stock-token balance in its TBA.
3. Enough ETH in the owner EOA for Robinhood Chain gas.
4. A Uniswap Developer API key.
5. An X developer app and OAuth user access token with `tweet.read`,
   `tweet.write`, and `users.read`.

Stock tokens and automated trading involve financial risk. Use a tiny amount for the proof transaction.

## Contributing and security

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening
a pull request. Report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md); never publish keys, tokens, or an unpatched exploit.

Licensed under the [MIT License](LICENSE).
