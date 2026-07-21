import { BrokerService } from "./broker.js";
import { loadConfig, resolveTokenId } from "./config.js";
import {
  UNISWAP_SWAP_PROXY,
  UNISWAP_UNIVERSAL_ROUTER,
  UNISWAP_UNIVERSAL_ROUTER_VERSION,
} from "./constants.js";

const config = loadConfig();
const broker = new BrokerService(config);
const tokenId = resolveTokenId(config, config.defaultTokenId ? undefined : 1);

await broker.assertInfrastructure();
const portfolio = await broker.portfolio(tokenId);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      chainId: 4663,
      tokenId: tokenId.toString(),
      nftAddress: portfolio.identity.nftAddress,
      owner: portfolio.identity.owner,
      tokenBoundWallet: portfolio.identity.wallet,
      accountImplementation: portfolio.identity.accountImplementation,
      uniswapUniversalRouterVersion: UNISWAP_UNIVERSAL_ROUTER_VERSION,
      uniswapUniversalRouter: UNISWAP_UNIVERSAL_ROUTER,
      uniswapSwapProxy: UNISWAP_SWAP_PROXY,
      canonicalStockPositions: portfolio.positions.map((position) => ({
        symbol: position.asset.symbol,
        address: position.asset.address,
        balance: position.formattedBalance,
      })),
    },
    null,
    2,
  )}\n`,
);
