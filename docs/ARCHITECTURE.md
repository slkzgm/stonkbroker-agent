# Architecture evidence and claim boundaries

Last verified: 2026-07-21.

## The claim

Robinhood Trading MCP and a StonkBroker token-bound account are different
execution domains. Based on Robinhood's currently published interfaces, the
Trading MCP cannot by itself execute a trade from the StonkBroker TBA. A
separate onchain execution tool is therefore required for the bounty target.

This is a statement about the documented interfaces today. It is not a claim
about private Robinhood systems or features Robinhood may add later.

## Primary evidence

| Fact | Primary source | Architectural consequence |
| --- | --- | --- |
| Robinhood Trading MCP connects a third-party agent to a Robinhood Agentic account, and the agent can only place trades in that Agentic account. | [Robinhood — Agentic Trading overview](https://robinhood.com/us/en/support/articles/agentic-trading-overview/) | Its documented write scope is a brokerage Agentic account, not an arbitrary EVM wallet. |
| Robinhood Chain is permissionless and independent of Robinhood brokerage and crypto accounts. | [Robinhood — Robinhood Chain](https://robinhood.com/us/en/support/articles/robinhood-chain-mainnet/) | A brokerage order and a Robinhood Chain transaction update separate account systems. |
| The bounty asks for an agent connected to a StonkBroker token-bound wallet and trading Stock Tokens on Robinhood Chain. | [OxSimpleFarmer — builder challenge](https://x.com/OxSimpleFarmer/status/2079648383413735852) | The asset-holding account in scope is the TBA, so the proof must show an onchain state change from that account. |
| Each StonkBroker has an ERC-6551 token-bound wallet containing its stock-token holdings. | [StonkBrokers documentation](https://www.stonkbrokers.cash/docs) | The NFT's wallet, rather than a Robinhood brokerage account, is the source of the bounty trade. |
| The verified account contract derives `owner()` from the NFT's `ownerOf(tokenId)` and restricts `executeCall` to that owner. | [Verified `StonkBroker6551Account` contract](https://robinhoodchain.blockscout.com/address/0xE946075125843aAdb5e40e59f513d929AF507C4B) | The current NFT owner must authorize the TBA's external calls under the deployed contract's present design. |

## Reasoning

1. The balances to be traded are ERC-20 balances held by the TBA on chain
   `4663`.
2. Changing those balances requires a Robinhood Chain transaction executed by,
   or on behalf of, that TBA.
3. The deployed TBA permits `executeCall` only when the caller is the current
   StonkBroker NFT owner.
4. Robinhood documents the Trading MCP's trade scope as the dedicated Agentic
   brokerage account and documents Robinhood Chain as independent from that
   account system.
5. Therefore the Trading MCP, as documented, is not sufficient to move the
   TBA's assets. This project adds the missing agent-to-TBA execution interface.

## What this project does not claim

- It does not claim Robinhood Trading MCP is unnecessary in general. The same
  agent can connect to it for its documented brokerage and research features.
- It does not claim Uniswap is the only possible swap venue. This implementation
  uses Uniswap and validates its generated transaction before submission.
- It does not claim a Robinhood brokerage security position and a Robinhood
  Chain Stock Token are the same account asset.
- It does not claim Robinhood, StonkBrokers, Uniswap, or X endorses this project.
- It does not claim the boundary can never change. If Robinhood publishes a
  Trading MCP tool that explicitly accepts and controls external EVM/TBA
  addresses, this analysis must be revisited.

## Bounty proof standard

A defensible live demonstration should show all of the following:

1. MCP tool discovery for this server.
2. The StonkBroker NFT ID, current owner, and verified TBA address.
3. The TBA's stock-token balances before the trade.
4. The owner-authorized `executeCall` transaction on Robinhood Chain.
5. The TBA's actual input/output balance deltas after confirmation.
6. The automatically generated X post linking to that transaction.

That evidence demonstrates the requested agent-to-token-bound-wallet path
without making claims about capabilities outside the public Robinhood Trading
MCP documentation.
