# Bounty proof checklist

Challenge sources: [Robinhood's StonkBrokers announcement](https://x.com/RobinhoodApp/status/2079195918595764300),
[implementation requirements](https://x.com/RobinhoodApp/status/2079195919904383321),
and [the bounty call](https://x.com/vladtenev/status/2079636976941387809).

The code is a submission candidate. Do not call it a verified working bounty
entry until the transaction and automatically generated X post below both
exist publicly.

The challenge asks for a real program that:

1. Connects a StonkBroker token-bound wallet to an agent.
2. Lets it trade stock tokens on Robinhood Chain.
3. Automatically posts every trade to X.

## Requirement mapping

| Challenge requirement | Proof in this project |
| --- | --- |
| Agent connection | A stdio MCP server exposes six typed tools to any compatible AI agent. |
| StonkBroker wallet | `broker_status` resolves `tokenWallet(tokenId)` and verifies both sides of the ERC-6551 binding. |
| Stock-token trading | `execute_stock_trade` submits an exact ERC-20 approval and a decoded Uniswap Swap Proxy call through the verified TBA on chain `4663`. |
| Automatic X post | The confirmed swap is persisted in an outbox, formatted from actual balance deltas, submitted to `POST /2/tweets`, and retried on failure. |
| Real and verifiable | The tool returns the Robinhood Chain transaction hash, Blockscout link, and X post ID. |

## Evidence to capture

- Agent tool list showing `broker_status`, `quote_stock_trade`, and `execute_stock_trade`.
- `broker_status` output with NFT ID, owner, TBA, and balances.
- Quote output with the same TBA as swapper and recipient.
- Successful `execute_stock_trade` output.
- Blockscout transaction showing the owner calling `TBA.executeCall`, with internal token approval/swap activity.
- X post containing the actual pair, amounts, and Blockscout link.

## Live-proof runbook

Do not paste secrets into an issue, chat, MCP prompt, recording, or shell
history. Put them in a local `.env` copied from `.env.example`, then set:

```dotenv
BROKER_TOKEN_ID=<controlled NFT id>
UNISWAP_API_KEY=<local secret>
OWNER_PRIVATE_KEY=<local secret>
ALLOW_LIVE_TRADING=true
MAX_TRADE_BPS=500
X_USER_ACCESS_TOKEN=<local OAuth user token>
REQUIRE_X_POST=true
X_DRY_RUN=false
```

The operator must verify that the signer is the current NFT owner, that its
EOA has Robinhood Chain ETH for gas, and that the TBA holds both the input
stock token and enough value for a tiny demonstration trade.

```bash
pnpm run verify:chain
pnpm run build
pnpm run proof -- --inspect-only --token-id <controlled NFT id>
pnpm run proof -- --token-id <controlled NFT id> --in <symbol> --out <symbol> --amount <tiny amount> --slippage 0.5
```

The proof runner starts the MCP server, captures the tool list,
`system_health`, and `broker_status`, requests a small quote, and then pauses.
Review every returned field and only then type the literal confirmation
`EXECUTE`. It writes `.stonkagent/bounty-proof.json` with mode `0600`; save the
returned transaction URL and X post ID. Check the Blockscout receipt and the
public X post before publishing the submission. If the swap confirms but X is
temporarily unavailable, keep the outbox file and invoke `retry_x_posts`; never
execute a second trade merely to recreate a post.

## Submission text

> Shipped: an MCP agent that controls a StonkBroker's verified ERC-6551 wallet on Robinhood Chain. It resolves only canonical Robinhood stock tokens, quotes and executes the swap through Uniswap from the TBA itself, waits for confirmation, measures actual token deltas, and automatically posts the trade + tx link to X with a durable retry queue.

Attach the repository, a short screen recording, the swap transaction, and the generated X post. Tag the challenge author for verification.
