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
X_USER_ACCESS_TOKEN=<OAuth user token with tweet.write>
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
- A quote cannot spend more than `MAX_TRADE_BPS` of the current input-token balance (25% by default).
- Only canonical contracts returned by Robinhood's live registry can be selected.
- Quotes are forced to immediate Uniswap AMM routes; intent orders are not used.
- Permit2 is disabled. Approval calldata must target the input token, approve the exact Uniswap swap target, and never exceed the quoted input amount.
- The NFT owner, predicted TBA, deployed TBA, implementation, TBA owner, token contract, and token ID are checked before trading.
- Swap calldata must identify the TBA as `from`, target chain `4663`, and survive an `eth_call` simulation through `executeCall`.
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

`verify:chain` performs live read-only checks against chain `4663`, including the NFT/TBA linkage and canonical stock-token balances. The test suite covers canonical-asset filtering, calldata safety, X post formatting, and outbox persistence.

## Why this does not use Robinhood Trading MCP

Robinhood Trading MCP controls a dedicated brokerage Agentic account. A StonkBroker is an NFT on Robinhood Chain whose assets live in an ERC-6551 smart wallet. These are separate systems. This project follows the MCP idea from Robinhood's announcement, but the actual execution path must be onchain: the NFT owner calls the TBA, and the TBA trades canonical Robinhood stock tokens through Uniswap.

## External prerequisites for a public bounty demo

The repository is complete without embedding credentials, but a public live proof still requires:

1. A StonkBroker controlled by the demo signer.
2. Input stock-token balance in its TBA.
3. Enough ETH in the owner EOA for Robinhood Chain gas.
4. A Uniswap Developer API key.
5. An X developer app and OAuth user access token with `tweet.write`.

Stock tokens and automated trading involve financial risk. Use a tiny amount for the proof transaction.

## Contributing and security

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening
a pull request. Report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md); never publish keys, tokens, or an unpatched exploit.

Licensed under the [MIT License](LICENSE).
