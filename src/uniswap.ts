import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";

import {
  CHAIN_ID,
  UNISWAP_API_URL,
  UNISWAP_UNIVERSAL_ROUTER_VERSION,
} from "./constants.js";
import type { QuoteEnvelope, TransactionRequest } from "./types.js";

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

    return validateQuoteEnvelope(response, input);
  }

  async buildSwap(quote: QuoteEnvelope): Promise<TransactionRequest> {
    const response = await this.post<SwapResponse>("/swap", {
      quote: quote.quote,
      refreshGasPrice: true,
      simulateTransaction: false,
      deadline: Math.floor(Date.now() / 1_000) + 120,
    });
    if (!response || typeof response !== "object" || !response.swap) {
      throw new Error("Uniswap swap response did not include a transaction");
    }
    return normalizeTransaction(response.swap);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "x-universal-router-version": UNISWAP_UNIVERSAL_ROUTER_VERSION,
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

export function validateQuoteEnvelope(
  envelope: QuoteEnvelope,
  expected: {
    tokenIn: Address;
    tokenOut: Address;
    amount: bigint;
    swapper: Address;
  },
): QuoteEnvelope {
  if (!envelope || typeof envelope !== "object") {
    throw new Error("Uniswap returned an invalid quote response");
  }
  if (!envelope.requestId || typeof envelope.requestId !== "string") {
    throw new Error("Uniswap quote did not include a request ID");
  }
  if (envelope.routing !== "CLASSIC") {
    throw new Error(`Expected a CLASSIC Uniswap route, received ${envelope.routing}`);
  }
  if (envelope.permitData != null) {
    throw new Error("Uniswap returned Permit2 data even though direct approvals are enabled");
  }

  const quotedInput = envelope.quote?.input;
  const quotedOutput = envelope.quote?.output;
  if (!quotedInput || !quotedOutput) {
    throw new Error("Uniswap quote is missing its input or output");
  }
  if (!quotedInput.amount || !/^\d+$/.test(quotedInput.amount)) {
    throw new Error("Uniswap quote did not include a valid input amount");
  }
  if (BigInt(quotedInput.amount) !== expected.amount) {
    throw new Error("Uniswap quote input amount does not match the request");
  }
  assertMatchingAddress(quotedInput.token, expected.tokenIn, "input token");

  if (!quotedOutput.amount || !/^\d+$/.test(quotedOutput.amount) || BigInt(quotedOutput.amount) <= 0n) {
    throw new Error("Uniswap quote did not include a valid output amount");
  }
  assertMatchingAddress(quotedOutput.token, expected.tokenOut, "output token");
  assertMatchingAddress(quotedOutput.recipient, expected.swapper, "output recipient");
  return envelope;
}

function normalizeTransaction(transaction: TransactionRequest): TransactionRequest {
  if (!isAddress(transaction.to) || !isAddress(transaction.from)) {
    throw new Error("Uniswap returned an invalid transaction address");
  }
  if (!transaction.data || transaction.data === "0x" || !isHex(transaction.data, { strict: true })) {
    throw new Error("Uniswap returned invalid or empty transaction calldata");
  }
  if (transaction.chainId !== CHAIN_ID) {
    throw new Error(`Uniswap transaction targets chain ${transaction.chainId}`);
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

function assertMatchingAddress(
  actual: string | undefined,
  expected: Address,
  field: string,
): void {
  if (!actual || !isAddress(actual) || getAddress(actual) !== getAddress(expected)) {
    throw new Error(`Uniswap quote ${field} does not match the request`);
  }
}
