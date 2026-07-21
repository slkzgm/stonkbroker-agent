import { BrokerService } from "./broker.js";
import { loadConfig, resolveTokenId } from "./config.js";
const config = loadConfig();
const broker = new BrokerService(config);
const tokenId = resolveTokenId(config, config.defaultTokenId ? undefined : 1);
await broker.assertNetwork();
const portfolio = await broker.portfolio(tokenId);
process.stdout.write(`${JSON.stringify({
    ok: true,
    chainId: 4663,
    tokenId: tokenId.toString(),
    nftAddress: portfolio.identity.nftAddress,
    owner: portfolio.identity.owner,
    tokenBoundWallet: portfolio.identity.wallet,
    accountImplementation: portfolio.identity.accountImplementation,
    canonicalStockPositions: portfolio.positions.map((position) => ({
        symbol: position.asset.symbol,
        address: position.asset.address,
        balance: position.formattedBalance,
    })),
}, null, 2)}\n`);
//# sourceMappingURL=verify-chain.js.map