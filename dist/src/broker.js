import { createPublicClient, formatEther, getAddress, http, } from "viem";
import { stonkBrokerAccountAbi, stonkBrokerNftAbi } from "./abis.js";
import { fetchCanonicalPortfolio } from "./blockscout.js";
import { CHAIN_ID, KNOWN_STONKBROKER_ACCOUNT_IMPLEMENTATION, robinhoodChain } from "./constants.js";
import { RobinhoodAssetRegistry } from "./robinhood-assets.js";
export class BrokerService {
    config;
    assets;
    publicClient;
    constructor(config, assets = new RobinhoodAssetRegistry(), publicClient) {
        this.config = config;
        this.assets = assets;
        this.publicClient =
            publicClient ??
                createPublicClient({
                    chain: robinhoodChain,
                    transport: http(config.rpcUrl),
                });
    }
    async assertNetwork() {
        const chainId = await this.publicClient.getChainId();
        if (chainId !== CHAIN_ID) {
            throw new Error(`RPC is on chain ${chainId}; expected Robinhood Chain ${CHAIN_ID}`);
        }
    }
    async identity(tokenId) {
        const nftAddress = this.config.nftAddress;
        const [owner, wallet, predictedWallet, accountImplementation, fundedToken, initialWalletGrant] = await Promise.all([
            this.publicClient.readContract({
                address: nftAddress,
                abi: stonkBrokerNftAbi,
                functionName: "ownerOf",
                args: [tokenId],
            }),
            this.publicClient.readContract({
                address: nftAddress,
                abi: stonkBrokerNftAbi,
                functionName: "tokenWallet",
                args: [tokenId],
            }),
            this.publicClient.readContract({
                address: nftAddress,
                abi: stonkBrokerNftAbi,
                functionName: "predictWallet",
                args: [tokenId],
            }),
            this.publicClient.readContract({
                address: nftAddress,
                abi: stonkBrokerNftAbi,
                functionName: "accountImplementation",
            }),
            this.publicClient.readContract({
                address: nftAddress,
                abi: stonkBrokerNftAbi,
                functionName: "fundedToken",
                args: [tokenId],
            }),
            this.publicClient.readContract({
                address: nftAddress,
                abi: stonkBrokerNftAbi,
                functionName: "initialWalletGrant",
                args: [tokenId],
            }),
        ]);
        if (getAddress(wallet) !== getAddress(predictedWallet)) {
            throw new Error(`TBA mismatch for StonkBroker #${tokenId}`);
        }
        if (getAddress(accountImplementation) !== KNOWN_STONKBROKER_ACCOUNT_IMPLEMENTATION) {
            throw new Error(`Unexpected StonkBroker account implementation: ${accountImplementation}`);
        }
        const [tbaOwner, tbaTokenContract, tbaTokenId] = await Promise.all([
            this.publicClient.readContract({
                address: wallet,
                abi: stonkBrokerAccountAbi,
                functionName: "owner",
            }),
            this.publicClient.readContract({
                address: wallet,
                abi: stonkBrokerAccountAbi,
                functionName: "tokenContract",
            }),
            this.publicClient.readContract({
                address: wallet,
                abi: stonkBrokerAccountAbi,
                functionName: "tokenId",
            }),
        ]);
        if (getAddress(tbaOwner) !== getAddress(owner) ||
            getAddress(tbaTokenContract) !== nftAddress ||
            tbaTokenId !== tokenId) {
            throw new Error(`ERC-6551 ownership binding is invalid for StonkBroker #${tokenId}`);
        }
        return {
            tokenId,
            nftAddress,
            owner: getAddress(owner),
            wallet: getAddress(wallet),
            accountImplementation: getAddress(accountImplementation),
            fundedToken: getAddress(fundedToken),
            initialWalletGrant,
        };
    }
    async portfolio(tokenId) {
        const identity = await this.identity(tokenId);
        const [ethBalance, assetsByAddress] = await Promise.all([
            this.publicClient.getBalance({ address: identity.wallet }),
            this.assets.byAddress(),
        ]);
        const positions = await fetchCanonicalPortfolio(identity.wallet, assetsByAddress);
        return { identity, ethBalance: formatEther(ethBalance), positions };
    }
    async tokenBalance(wallet, token) {
        return this.publicClient.readContract({
            address: token,
            abi: [
                {
                    type: "function",
                    name: "balanceOf",
                    stateMutability: "view",
                    inputs: [{ name: "account", type: "address" }],
                    outputs: [{ name: "", type: "uint256" }],
                },
            ],
            functionName: "balanceOf",
            args: [wallet],
        });
    }
    async tokenDecimals(token) {
        return this.publicClient.readContract({
            address: token,
            abi: [
                {
                    type: "function",
                    name: "decimals",
                    stateMutability: "view",
                    inputs: [],
                    outputs: [{ name: "", type: "uint8" }],
                },
            ],
            functionName: "decimals",
        });
    }
}
//# sourceMappingURL=broker.js.map