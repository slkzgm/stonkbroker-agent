import type { Address, Hash, Hex } from "viem";

export interface RobinhoodAsset {
  id: string;
  symbol: string;
  name: string;
  address: Address;
  status: string;
  logoUrl?: string;
  tradable: boolean;
}

export interface PortfolioPosition {
  asset: RobinhoodAsset;
  rawBalance: bigint;
  decimals: number;
  formattedBalance: string;
  exchangeRateUsd?: string;
}

export interface BrokerIdentity {
  tokenId: bigint;
  nftAddress: Address;
  owner: Address;
  wallet: Address;
  accountImplementation: Address;
  fundedToken: Address;
  initialWalletGrant: bigint;
}

export interface TransactionRequest {
  to: Address;
  from: Address;
  data: Hex;
  value: string;
  chainId: number;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
}

export interface QuoteEnvelope {
  requestId: string;
  routing: string;
  quote: {
    input?: { amount?: string; token?: string; maximumAmount?: string };
    output?: { amount?: string; token?: string; minimumAmount?: string; recipient?: string };
    [key: string]: unknown;
  };
  permitData?: unknown;
  isTokenApprovalApplicable?: boolean;
}

export interface StoredQuote {
  id: string;
  createdAt: number;
  expiresAt: number;
  tokenId: bigint;
  wallet: Address;
  owner: Address;
  tokenIn: RobinhoodAsset;
  tokenOut: RobinhoodAsset;
  tokenInDecimals: number;
  tokenOutDecimals: number;
  amountIn: bigint;
  quotedAmountOut: bigint;
  slippagePercent: number;
  envelope: QuoteEnvelope;
}

export interface TradePost {
  id: string;
  tokenId: string;
  wallet: Address;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  amountIn: string;
  amountOut: string;
  txHash: Hash;
  explorerUrl: string;
  confirmedAt: string;
  approvalTxHashes: Hash[];
  postedAt?: string;
  xPostId?: string;
  attempts: number;
  lastError?: string;
}
