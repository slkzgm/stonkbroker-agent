import { defineChain, getAddress } from "viem";
export const CHAIN_ID = 4663;
export const DEFAULT_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const BLOCKSCOUT_URL = "https://robinhoodchain.blockscout.com";
export const BLOCKSCOUT_API_URL = `${BLOCKSCOUT_URL}/api/v2`;
export const ROBINHOOD_ASSETS_URL = "https://api.robinhood.com/rhj/assets";
export const UNISWAP_API_URL = "https://trade-api.gateway.uniswap.org/v1";
export const X_API_URL = "https://api.x.com/2/tweets";
export const X_API_USER_ME_URL = "https://api.x.com/2/users/me";
// Robinhood Chain has no Universal Router 2.0 deployment. Keep this explicit so
// an API default change cannot silently switch the calldata target.
export const UNISWAP_UNIVERSAL_ROUTER_VERSION = "2.1.1";
export const UNISWAP_UNIVERSAL_ROUTER = getAddress("0x8876789976decbfcbbbe364623c63652db8c0904");
// Official deterministic proxy used by Uniswap's x-permit2-disabled flow.
export const UNISWAP_SWAP_PROXY = getAddress("0x0000000085E102724e78eCd2F45DC9cA239Affad");
export const DEFAULT_STONKBROKER_NFT = getAddress("0x539CdD042c2f3d93EbC5BE7DfFf0c79F3B4fAbF0");
export const KNOWN_STONKBROKER_ACCOUNT_IMPLEMENTATION = getAddress("0xE946075125843aAdb5e40e59f513d929AF507C4B");
export const robinhoodChain = defineChain({
    id: CHAIN_ID,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
        default: { http: [DEFAULT_RPC_URL] },
    },
    blockExplorers: {
        default: { name: "Robinhood Chain Explorer", url: BLOCKSCOUT_URL },
    },
});
export const asAddress = (value) => getAddress(value);
//# sourceMappingURL=constants.js.map