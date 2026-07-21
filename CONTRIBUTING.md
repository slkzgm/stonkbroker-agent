# Contributing

Thanks for helping improve StonkBroker Agent.

## Development setup

You need Node.js 20+ and pnpm 10.

```bash
git clone https://github.com/slkzgm/stonkbroker-agent.git
cd stonkbroker-agent
corepack enable
pnpm install
cp .env.example .env
```

Before opening a pull request, run:

```bash
pnpm run check
pnpm run test
pnpm run build
```

`pnpm run verify:chain` performs live, read-only requests and is useful when a
change touches contract discovery or the Robinhood asset registry.

## Pull requests

- Keep changes focused and explain the user-visible effect.
- Add or update tests for behavior changes.
- Never commit private keys, API keys, OAuth tokens, `.env`, or outbox data.
- Do not enable live trading in tests or CI.
- Report security issues through GitHub private vulnerability reporting instead
  of a public issue.

By contributing, you agree that your contribution is licensed under the MIT
License.
