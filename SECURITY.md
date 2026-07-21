# Security policy

## Supported versions

Security fixes are applied to the latest release and the default branch.

## Reporting a vulnerability

Please use the repository's **Security → Report a vulnerability** flow so the
report and any proof of concept stay private:

https://github.com/slkzgm/stonkbroker-agent/security/advisories/new

Include the affected version or commit, impact, reproduction steps, and any
suggested mitigation. Please do not open a public issue for an unpatched
vulnerability or test an exploit against wallets you do not own.

## Operational warning

This software can submit irreversible mainnet transactions. Keep live trading
disabled while developing, use a dedicated low-value signer, review quotes
before confirmation, and grant the signer only the assets and gas needed for
the demonstration.
