# Changelog

All notable changes to this project will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and releases follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-07-21

### Added

- Add `stonkbroker-proof`, an interactive MCP client that captures the tool
  list, health, broker state, quote, confirmed transaction, and X result in a
  mode-`0600` evidence artifact without recording credentials.
- Add a read-only inspection mode so the complete MCP connection and public
  onchain identity can be verified before live credentials are configured.

## [0.1.2] - 2026-07-21

### Fixed

- Pin Robinhood Chain to its supported Uniswap Universal Router `2.1.1`
  instead of the unsupported `2.0` deployment.
- Replace API-generated approvals with decoded, exact local approvals to the
  deterministic Uniswap Swap Proxy.

### Security

- Bind quote responses to the requested tokens, amount, and TBA recipient.
- Decode Swap Proxy calldata and enforce the official proxy/router, exact input
  token and amount, zero native value, non-empty route, and short deadline.
- Decode V2, V3, nested, and V4 router plans; reject partial-failure and
  incompatible commands; and require the complete output to target the TBA.
- Consume every quote before its first execution attempt to prevent duplicate
  broadcasts after timeouts or concurrent calls.
- Reduce the default per-trade balance cap from 25% to 5% and verify X user
  credentials before submitting any onchain transaction.

## [0.1.1] - 2026-07-21

### Fixed

- Include the compiled distribution in Git releases so both `npx` and
  `pnpm dlx` can install directly from GitHub without running build scripts.

## [0.1.0] - 2026-07-21

### Added

- Stdio MCP server with six typed tools for inspection, quoting, execution, and
  X outbox retries.
- ERC-6551 ownership and account-binding verification on Robinhood Chain.
- Canonical Robinhood stock-token discovery and guarded Uniswap execution.
- Explicit live-trading gate, quote expiry, spend limits, simulation, receipt
  checks, and durable X posting.
- CLI, read-only chain verification, automated tests, and public documentation.

[Unreleased]: https://github.com/slkzgm/stonkbroker-agent/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/slkzgm/stonkbroker-agent/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/slkzgm/stonkbroker-agent/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/slkzgm/stonkbroker-agent/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/slkzgm/stonkbroker-agent/releases/tag/v0.1.0
