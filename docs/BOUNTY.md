# Bounty proof checklist

The challenge asks for a real program that:

1. Connects a StonkBroker token-bound wallet to an agent.
2. Lets it trade stock tokens on Robinhood Chain.
3. Automatically posts every trade to X.

## Requirement mapping

| Challenge requirement | Proof in this project |
| --- | --- |
| Agent connection | A stdio MCP server exposes six typed tools to any compatible AI agent. |
| StonkBroker wallet | `broker_status` resolves `tokenWallet(tokenId)` and verifies both sides of the ERC-6551 binding. |
| Stock-token trading | `execute_stock_trade` submits direct approval and Uniswap swap calls through the verified TBA on chain `4663`. |
| Automatic X post | The confirmed swap is persisted in an outbox, formatted from actual balance deltas, submitted to `POST /2/tweets`, and retried on failure. |
| Real and verifiable | The tool returns the Robinhood Chain transaction hash, Blockscout link, and X post ID. |

## Evidence to capture

- Agent tool list showing `broker_status`, `quote_stock_trade`, and `execute_stock_trade`.
- `broker_status` output with NFT ID, owner, TBA, and balances.
- Quote output with the same TBA as swapper and recipient.
- Successful `execute_stock_trade` output.
- Blockscout transaction showing the owner calling `TBA.executeCall`, with internal token approval/swap activity.
- X post containing the actual pair, amounts, and Blockscout link.

## Submission text

> Shipped: an MCP agent that controls a StonkBroker's verified ERC-6551 wallet on Robinhood Chain. It resolves only canonical Robinhood stock tokens, quotes and executes the swap through Uniswap from the TBA itself, waits for confirmation, measures actual token deltas, and automatically posts the trade + tx link to X with a durable retry queue.

Attach the repository, a short screen recording, the swap transaction, and the generated X post. Tag the challenge author for verification.
