import { getAddress, isAddress, type Address, type Hex } from "viem";

import { CHAIN_ID, UNISWAP_API_URL } from "./constants.js";
import type { QuoteEnvelope, TransactionRequest } from "./types.js";

interface ApprovalResponse {
  requestId: string;
  approval: TransactionRequest | null;
  cancel: TransactionRequest | null;
}

interface SwapResponse {
  requestId: string;
  swap: TransactionRequest;
}

export class UniswapClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = UNISWAP_API_URL,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async quote(input: {
    tokenIn: Address;
    tokenOut: Address;
    amount: bigint;
    swapper: Address;
    slippagePercent: number;
  }): Promise<QuoteEnvelope> {
    const response = await this.post<QuoteEnvelope>("/quote", {
      type: "EXACT_INPUT",
      amount: input.amount.toString(),
      tokenInChainId: CHAIN_ID,
      tokenOutChainId: CHAIN_ID,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      swapper: input.swapper,
      recipient: input.swapper,
      slippageTolerance: input.slippagePercent,
      routingPreference: "BEST_PRICE",
      protocols: ["V2", "V3", "V4"],
    });

    if (response.routing !== "CLASSIC") {
      throw new Error(`Expected a CLASSIC Uniswap route, received ${response.routing}`);
    }
    if (response.permitData != null) {
      throw new Error("Uniswap returned Permit2 data even though direct approvals are enabled");
    }
    return response;
  }

  async buildSwap(quote: QuoteEnvelope): Promise<TransactionRequest> {
    const response = await this.post<SwapResponse>("/swap", {
      quote: quote.quote,
      refreshGasPrice: true,
      simulateTransaction: false,
      deadline: Math.floor(Date.now() / 1_000) + 120,
    });
    return normalizeTransaction(response.swap);
  }

  async checkApproval(input: {
    wallet: Address;
    token: Address;
    tokenOut: Address;
    amount: bigint;
  }): Promise<ApprovalResponse> {
    const response = await this.post<ApprovalResponse>("/check_approval", {
      walletAddress: input.wallet,
      token: input.token,
      tokenOut: input.tokenOut,
      tokenOutChainId: CHAIN_ID,
      amount: input.amount.toString(),
      chainId: CHAIN_ID,
    });
    return {
      ...response,
      approval: response.approval ? normalizeTransaction(response.approval) : null,
      cancel: response.cancel ? normalizeTransaction(response.cancel) : null,
    };
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "x-universal-router-version": "2.0",
        "x-permit2-disabled": "true",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });

    const rawBody = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = rawBody;
    }

    if (!response.ok) {
      const message =
        typeof payload === "object" && payload !== null && "message" in payload
          ? String(payload.message)
          : rawBody.slice(0, 500);
      throw new Error(`Uniswap API ${path} returned HTTP ${response.status}: ${message}`);
    }
    return payload as T;
  }
}

function normalizeTransaction(transaction: TransactionRequest): TransactionRequest {
  if (!isAddress(transaction.to) || !isAddress(transaction.from)) {
    throw new Error("Uniswap returned an invalid transaction address");
  }
  if (!transaction.data || transaction.data === "0x") {
    throw new Error("Uniswap returned empty transaction calldata");
  }
  if (transaction.chainId !== CHAIN_ID) {
    throw new Error(`Uniswap transaction targets chain ${transaction.chainId}`);
  }
  if (!/^0x[0-9a-fA-F]+$/.test(transaction.data)) {
    throw new Error("Uniswap returned invalid transaction calldata");
  }
  try {
    if (BigInt(transaction.value) < 0n) throw new Error("negative value");
  } catch {
    throw new Error("Uniswap returned an invalid transaction value");
  }
  return {
    ...transaction,
    to: getAddress(transaction.to),
    from: getAddress(transaction.from),
    data: transaction.data as Hex,
  };
}
