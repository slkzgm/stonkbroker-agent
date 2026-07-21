import { randomUUID } from "node:crypto";

import {
  createWalletClient,
  decodeAbiParameters,
  decodeFunctionData,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  parseAbiParameters,
  parseUnits,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { erc20Abi, stonkBrokerAccountAbi, uniswapSwapProxyAbi } from "./abis.js";
import { BrokerService } from "./broker.js";
import type { AppConfig } from "./config.js";
import {
  BLOCKSCOUT_URL,
  CHAIN_ID,
  UNISWAP_SWAP_PROXY,
  UNISWAP_UNIVERSAL_ROUTER,
  robinhoodChain,
} from "./constants.js";
import { TradeOutbox } from "./outbox.js";
import type { StoredQuote, TradePost, TransactionRequest } from "./types.js";
import { UniswapClient } from "./uniswap.js";
import { XPublisher } from "./x.js";

const QUOTE_TTL_MS = 30_000;
const MAX_SWAP_DEADLINE_LEEWAY_SECONDS = 180n;
const ROUTER_ADDRESS_THIS = getAddress("0x0000000000000000000000000000000000000002");

const v3ExactInputParameters = parseAbiParameters(
  "address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser, uint256[] minHopPriceX36",
);
const v2ExactInputParameters = parseAbiParameters(
  "address recipient, uint256 amountIn, uint256 amountOutMin, address[] path, bool payerIsUser, uint256[] minHopPriceX36",
);
const paymentParameters = parseAbiParameters(
  "address token, address recipient, uint256 amount",
);
const commandsAndInputsParameters = parseAbiParameters("bytes commands, bytes[] inputs");
const v4SettleParameters = parseAbiParameters(
  "address currency, uint256 amount, bool payerIsUser",
);
const v4TakeParameters = parseAbiParameters(
  "address currency, address recipient, uint256 amount",
);

export class StonkTrader {
  private readonly quotes = new Map<string, StoredQuote>();
  private readonly outbox: TradeOutbox;
  private readonly publisher: XPublisher;

  constructor(
    readonly config: AppConfig,
    readonly broker: BrokerService,
    private readonly uniswap?: UniswapClient,
    outbox?: TradeOutbox,
    publisher?: XPublisher,
    private readonly transactionExecutor?: (
      transaction: TransactionRequest,
      wallet: Address,
      owner: Address,
    ) => Promise<Hash>,
  ) {
    this.outbox = outbox ?? new TradeOutbox(config.outboxPath);
    this.publisher = publisher ?? new XPublisher(config.xUserAccessToken, config.xDryRun);
  }

  async quoteTrade(input: {
    tokenId: bigint;
    tokenIn: string;
    tokenOut: string;
    amount: string;
    slippagePercent: number;
  }): Promise<StoredQuote> {
    const uniswap = this.requireUniswap();
    const [identity, tokenIn, tokenOut] = await Promise.all([
      this.broker.identity(input.tokenId),
      this.broker.assets.resolve(input.tokenIn),
      this.broker.assets.resolve(input.tokenOut),
      this.broker.assertInfrastructure(),
    ]);
    if (tokenIn.address === tokenOut.address) {
      throw new Error("Input and output tokens must differ");
    }
    if (!tokenIn.tradable || !tokenOut.tradable) {
      throw new Error("Both Robinhood assets must currently be marked tradable");
    }
    const [tokenInDecimals, tokenOutDecimals, balance] = await Promise.all([
      this.broker.tokenDecimals(tokenIn.address),
      this.broker.tokenDecimals(tokenOut.address),
      this.broker.tokenBalance(identity.wallet, tokenIn.address),
    ]);
    const amountIn = parseUnits(input.amount, tokenInDecimals);
    if (amountIn <= 0n) throw new Error("Trade amount must be positive");
    if (amountIn > balance) {
      throw new Error(
        `Insufficient ${tokenIn.symbol}: requested ${input.amount}, balance ${formatUnits(balance, tokenInDecimals)}`,
      );
    }
    if (amountIn * 10_000n > balance * BigInt(this.config.maxTradeBps)) {
      throw new Error(
        `Trade exceeds MAX_TRADE_BPS (${this.config.maxTradeBps} bps of the current balance)`,
      );
    }

    const envelope = await uniswap.quote({
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      amount: amountIn,
      swapper: identity.wallet,
      slippagePercent: input.slippagePercent,
    });
    const rawOutput = envelope.quote.output?.amount;
    if (!rawOutput || !/^\d+$/.test(rawOutput)) {
      throw new Error("Uniswap quote did not include a valid output amount");
    }

    const now = Date.now();
    const stored: StoredQuote = {
      id: randomUUID(),
      createdAt: now,
      expiresAt: now + QUOTE_TTL_MS,
      tokenId: input.tokenId,
      wallet: identity.wallet,
      owner: identity.owner,
      tokenIn,
      tokenOut,
      tokenInDecimals,
      tokenOutDecimals,
      amountIn,
      quotedAmountOut: BigInt(rawOutput),
      slippagePercent: input.slippagePercent,
      envelope,
    };
    this.pruneQuotes(now);
    this.quotes.set(stored.id, stored);
    return stored;
  }

  async executeTrade(quoteId: string): Promise<{
    trade: TradePost;
    postStatus: "posted" | "pending";
    xPostId?: string;
  }> {
    this.assertLiveTradingReady();
    const quote = this.quotes.get(quoteId);
    if (!quote) throw new Error("Unknown quoteId; request a new quote");
    if (Date.now() > quote.expiresAt) {
      this.quotes.delete(quoteId);
      throw new Error("Quote expired; request a fresh quote");
    }
    // One execution attempt per quote prevents a timeout or concurrent retry
    // from broadcasting the same irreversible swap twice.
    this.quotes.delete(quoteId);

    const identity = await this.broker.identity(quote.tokenId);
    if (identity.wallet !== quote.wallet || identity.owner !== quote.owner) {
      throw new Error("StonkBroker ownership changed after the quote was created");
    }

    const privateKey = this.config.ownerPrivateKey!;
    const account = privateKeyToAccount(privateKey);
    if (getAddress(account.address) !== identity.owner) {
      throw new Error(
        `OWNER_PRIVATE_KEY signs as ${account.address}, but StonkBroker #${quote.tokenId} is owned by ${identity.owner}`,
      );
    }
    const ownerGasBalance = await this.broker.nativeBalance(identity.owner);
    if (ownerGasBalance === 0n) {
      throw new Error("StonkBroker owner has no ETH on Robinhood Chain to pay transaction gas");
    }
    if (this.config.requireXPost) await this.publisher.verifyCredentials();

    const uniswap = this.requireUniswap();
    const [swap, inputBalanceBefore, outputBalanceBefore, currentAllowance] = await Promise.all([
      uniswap.buildSwap(quote.envelope),
      this.broker.tokenBalance(quote.wallet, quote.tokenIn.address),
      this.broker.tokenBalance(quote.wallet, quote.tokenOut.address),
      this.broker.tokenAllowance(
        quote.wallet,
        quote.tokenIn.address,
        UNISWAP_SWAP_PROXY,
      ),
    ]);
    validateSwapTransaction(
      swap,
      quote.wallet,
      quote.tokenIn.address,
      quote.tokenOut.address,
      quote.amountIn,
    );
    if (Date.now() > quote.expiresAt) {
      throw new Error("Quote expired during preflight; request a fresh quote");
    }
    if (quote.amountIn > inputBalanceBefore) {
      throw new Error("Input token balance fell below the quoted amount");
    }
    if (
      quote.amountIn * 10_000n >
      inputBalanceBefore * BigInt(this.config.maxTradeBps)
    ) {
      throw new Error("Trade now exceeds MAX_TRADE_BPS after a balance change");
    }

    const approvalTxHashes: Hash[] = [];
    for (const amount of requiredApprovalAmounts(currentAllowance, quote.amountIn)) {
      const transaction = approvalTransaction(
        quote.wallet,
        quote.tokenIn.address,
        UNISWAP_SWAP_PROXY,
        amount,
      );
      validateApprovalTransaction(
        transaction,
        quote.wallet,
        quote.tokenIn.address,
        UNISWAP_SWAP_PROXY,
        amount,
      );
      approvalTxHashes.push(
        await this.executeTbaCall(transaction, quote.wallet, account.address),
      );
    }

    const finalAllowance = await this.broker.tokenAllowance(
      quote.wallet,
      quote.tokenIn.address,
      UNISWAP_SWAP_PROXY,
    );
    if (finalAllowance !== quote.amountIn) {
      throw new Error(
        `Input-token allowance is ${finalAllowance}, expected exactly ${quote.amountIn}`,
      );
    }

    const txHash = await this.executeTbaCall(swap, quote.wallet, account.address);
    const [inputBalanceAfter, outputBalanceAfter] = await Promise.all([
      this.broker.tokenBalance(quote.wallet, quote.tokenIn.address),
      this.broker.tokenBalance(quote.wallet, quote.tokenOut.address),
    ]);
    const amountIn = inputBalanceBefore - inputBalanceAfter;
    const amountOut = outputBalanceAfter - outputBalanceBefore;
    if (amountIn <= 0n || amountOut <= 0n) {
      throw new Error(`Swap ${txHash} confirmed but token balance deltas are invalid`);
    }

    const trade: TradePost = {
      id: randomUUID(),
      tokenId: quote.tokenId.toString(),
      wallet: quote.wallet,
      tokenInSymbol: quote.tokenIn.symbol,
      tokenOutSymbol: quote.tokenOut.symbol,
      amountIn: formatUnits(amountIn, quote.tokenInDecimals),
      amountOut: formatUnits(amountOut, quote.tokenOutDecimals),
      txHash,
      explorerUrl: `${BLOCKSCOUT_URL}/tx/${txHash}`,
      confirmedAt: new Date().toISOString(),
      approvalTxHashes,
      attempts: 0,
    };
    await this.outbox.enqueue(trade);

    try {
      const result = await this.publisher.publish(trade);
      if (result.dryRun) throw new Error("X_DRY_RUN is enabled");
      await this.outbox.markPosted(trade.id, result.postId);
      return { trade, postStatus: "posted", xPostId: result.postId };
    } catch (error) {
      await this.outbox.markFailed(trade.id, error);
      return { trade, postStatus: "pending" };
    }
  }

  async flushPendingPosts(): Promise<{ posted: number; failed: number; remaining: number }> {
    return this.outbox.flush(this.publisher);
  }

  private async executeTbaCall(
    transaction: TransactionRequest,
    wallet: Address,
    owner: Address,
  ): Promise<Hash> {
    if (this.transactionExecutor) {
      return this.transactionExecutor(transaction, wallet, owner);
    }
    const account = privateKeyToAccount(this.config.ownerPrivateKey!);
    const walletClient = createWalletClient({
      account,
      chain: robinhoodChain,
      transport: http(this.config.rpcUrl),
    });
    const value = BigInt(transaction.value);
    const { request } = await this.broker.publicClient.simulateContract({
      account: owner,
      address: wallet,
      abi: stonkBrokerAccountAbi,
      functionName: "executeCall",
      args: [transaction.to, value, transaction.data],
      value: 0n,
    });
    const hash = await walletClient.writeContract(request);
    const receipt = await this.broker.publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 60_000,
    });
    if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
    return hash;
  }

  private requireUniswap(): UniswapClient {
    if (!this.uniswap) throw new Error("UNISWAP_API_KEY is not configured");
    return this.uniswap;
  }

  private assertLiveTradingReady(): void {
    if (!this.config.allowLiveTrading) {
      throw new Error("Live trading is disabled; set ALLOW_LIVE_TRADING=true after reviewing the quote");
    }
    if (!this.config.ownerPrivateKey) throw new Error("OWNER_PRIVATE_KEY is not configured");
    if (this.config.requireXPost && (!this.config.xUserAccessToken || this.config.xDryRun)) {
      throw new Error(
        "Live trading requires a real X_USER_ACCESS_TOKEN while REQUIRE_X_POST=true",
      );
    }
  }

  private pruneQuotes(now: number): void {
    for (const [id, quote] of this.quotes) {
      if (quote.expiresAt < now) this.quotes.delete(id);
    }
  }
}

export function validateSwapTransaction(
  transaction: TransactionRequest,
  wallet: Address,
  tokenIn: Address,
  tokenOut: Address,
  exactAmountIn: bigint,
  nowSeconds = BigInt(Math.floor(Date.now() / 1_000)),
): void {
  if (transaction.chainId !== CHAIN_ID) throw new Error("Swap targets the wrong chain");
  if (getAddress(transaction.from) !== getAddress(wallet)) {
    throw new Error("Swap sender is not the StonkBroker TBA");
  }
  if (getAddress(transaction.to) !== UNISWAP_SWAP_PROXY) {
    throw new Error("Swap target is not the official Uniswap Swap Proxy");
  }
  if (BigInt(transaction.value) !== 0n) {
    throw new Error("Stock-token swap unexpectedly sends native value");
  }
  if (transaction.data === "0x") throw new Error("Swap calldata is empty");

  let decoded: ReturnType<typeof decodeFunctionData<typeof uniswapSwapProxyAbi>>;
  try {
    decoded = decodeFunctionData({ abi: uniswapSwapProxyAbi, data: transaction.data as Hex });
  } catch {
    throw new Error("Swap calldata is not a supported Swap Proxy call");
  }
  if (decoded.functionName !== "execute") {
    throw new Error("Swap calldata does not call Swap Proxy execute()");
  }
  const [router, token, amount, commands, inputs, deadline] = decoded.args;
  if (getAddress(router) !== UNISWAP_UNIVERSAL_ROUTER) {
    throw new Error("Swap calldata does not use Robinhood Chain Universal Router 2.1.1");
  }
  if (getAddress(token) !== getAddress(tokenIn)) {
    throw new Error("Swap calldata input token does not match the quote");
  }
  if (amount !== exactAmountIn) {
    throw new Error("Swap calldata input amount does not match the quote");
  }
  if (commands === "0x" || inputs.length === 0) {
    throw new Error("Swap Proxy route is empty");
  }
  if (!validateRouterPlan(commands, inputs, wallet, tokenOut)) {
    throw new Error("Universal Router plan does not deliver the output token to the TBA");
  }
  if (deadline <= nowSeconds || deadline > nowSeconds + MAX_SWAP_DEADLINE_LEEWAY_SECONDS) {
    throw new Error("Swap deadline is expired or unexpectedly far in the future");
  }
}

function validateRouterPlan(
  commands: Hex,
  inputs: readonly Hex[],
  wallet: Address,
  tokenOut: Address,
): boolean {
  const state = { delivered: false, routerHoldsOutput: false };
  validateRouterCommands(commands, inputs, wallet, tokenOut, state);
  return state.delivered && !state.routerHoldsOutput;
}

function validateRouterCommands(
  commands: Hex,
  inputs: readonly Hex[],
  wallet: Address,
  tokenOut: Address,
  state: { delivered: boolean; routerHoldsOutput: boolean },
): void {
  const commandBytes = hexBytes(commands);
  if (commandBytes.length !== inputs.length) {
    throw new Error("Universal Router commands and inputs have different lengths");
  }
  for (let index = 0; index < commandBytes.length; index += 1) {
    const commandByte = commandBytes[index]!;
    if ((commandByte & 0x80) !== 0) {
      throw new Error("Universal Router allow-revert commands are not accepted");
    }
    const command = commandByte & 0x7f;
    const input = inputs[index]!;

    try {
      if (command === 0x00) {
        const [recipient, , , path, payerIsUser] = decodeAbiParameters(
          v3ExactInputParameters,
          input,
        );
        assertSafeRecipient(recipient, wallet);
        if (payerIsUser) throw new Error("V3 swap asks the proxy to pay through Permit2");
        if (getAddress(v3OutputToken(path)) === getAddress(tokenOut)) {
          markOutputRecipient(recipient, wallet, state);
        }
      } else if (command === 0x08) {
        const [recipient, , , path, payerIsUser] = decodeAbiParameters(
          v2ExactInputParameters,
          input,
        );
        assertSafeRecipient(recipient, wallet);
        if (payerIsUser) throw new Error("V2 swap asks the proxy to pay through Permit2");
        const routeOutput = path.at(-1);
        if (!routeOutput) throw new Error("V2 swap path is empty");
        if (getAddress(routeOutput) === getAddress(tokenOut)) {
          markOutputRecipient(recipient, wallet, state);
        }
      } else if (command === 0x04) {
        const [token, recipient] = decodeAbiParameters(paymentParameters, input);
        assertSafeRecipient(recipient, wallet);
        if (getAddress(token) === getAddress(tokenOut)) {
          if (isWallet(recipient, wallet)) {
            state.delivered = true;
            state.routerHoldsOutput = false;
          } else {
            state.routerHoldsOutput = true;
          }
        }
      } else if (command === 0x0e) {
        // BALANCE_CHECK_ERC20 is read-only and has no recipient.
        decodeAbiParameters(paymentParameters, input);
      } else if (command === 0x10) {
        validateV4Plan(input, wallet, tokenOut, state);
      } else if (command === 0x21) {
        const [subcommands, subinputs] = decodeAbiParameters(commandsAndInputsParameters, input);
        validateRouterCommands(subcommands, subinputs, wallet, tokenOut, state);
      } else {
        throw new Error(`Universal Router command 0x${command.toString(16)} is not allowed`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid Universal Router command at index ${index}: ${message}`);
    }
  }
}

function validateV4Plan(
  input: Hex,
  wallet: Address,
  tokenOut: Address,
  state: { delivered: boolean; routerHoldsOutput: boolean },
): void {
  const [actions, parameters] = decodeAbiParameters(commandsAndInputsParameters, input);
  const actionBytes = hexBytes(actions);
  if (actionBytes.length !== parameters.length) {
    throw new Error("Uniswap V4 actions and parameters have different lengths");
  }
  for (let index = 0; index < actionBytes.length; index += 1) {
    const action = actionBytes[index]!;
    const parametersForAction = parameters[index]!;
    if (action === 0x06 || action === 0x07) {
      // Exact-input V4 swap parameters are fully decoded by the deployed router.
      // Their payment and output destinations are handled by SETTLE/TAKE actions below.
      if (parametersForAction === "0x") throw new Error("Uniswap V4 swap parameters are empty");
    } else if (action === 0x0b) {
      const [, , payerIsUser] = decodeAbiParameters(v4SettleParameters, parametersForAction);
      if (payerIsUser) throw new Error("V4 settlement asks the proxy to pay through Permit2");
    } else if (action === 0x0c) {
      // SETTLE_ALL draws the currency already held by the router.
      decodeAbiParameters(parseAbiParameters("address currency, uint256 maxAmount"), parametersForAction);
    } else if (action === 0x0e) {
      const [currency, recipient, amount] = decodeAbiParameters(
        v4TakeParameters,
        parametersForAction,
      );
      assertSafeRecipient(recipient, wallet);
      if (getAddress(currency) === getAddress(tokenOut) && isWallet(recipient, wallet)) {
        if (amount !== 0n) {
          throw new Error("V4 output TAKE does not withdraw the complete open delta");
        }
        state.delivered = true;
      } else if (getAddress(currency) === getAddress(tokenOut)) {
        if (amount !== 0n) {
          throw new Error("V4 output TAKE does not withdraw the complete open delta");
        }
        state.routerHoldsOutput = true;
      }
    } else {
      throw new Error(`Uniswap V4 action 0x${action.toString(16)} is not allowed`);
    }
  }
}

function markOutputRecipient(
  recipient: Address,
  wallet: Address,
  state: { delivered: boolean; routerHoldsOutput: boolean },
): void {
  if (isWallet(recipient, wallet)) state.delivered = true;
  else state.routerHoldsOutput = true;
}

function assertSafeRecipient(recipient: Address, wallet: Address): void {
  if (!isWallet(recipient, wallet) && getAddress(recipient) !== ROUTER_ADDRESS_THIS) {
    throw new Error("Swap output recipient is neither the TBA nor the router itself");
  }
}

function isWallet(recipient: Address, wallet: Address): boolean {
  return getAddress(recipient) === getAddress(wallet);
}

function v3OutputToken(path: Hex): Address {
  const raw = path.slice(2);
  if (raw.length < 86 || (raw.length - 40) % 46 !== 0) {
    throw new Error("V3 swap path is malformed");
  }
  return getAddress(`0x${raw.slice(-40)}`);
}

function hexBytes(value: Hex): number[] {
  const raw = value.slice(2);
  if (raw.length === 0 || raw.length % 2 !== 0) throw new Error("Command bytes are malformed");
  return raw.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16));
}

export function validateApprovalTransaction(
  transaction: TransactionRequest,
  wallet: Address,
  tokenIn: Address,
  swapTarget: Address,
  exactApprovalAmount: bigint,
): void {
  if (transaction.chainId !== CHAIN_ID) throw new Error("Approval targets the wrong chain");
  if (getAddress(transaction.from) !== getAddress(wallet)) {
    throw new Error("Approval sender is not the StonkBroker TBA");
  }
  if (getAddress(transaction.to) !== getAddress(tokenIn)) {
    throw new Error("Approval target is not the input token");
  }
  if (BigInt(transaction.value) !== 0n) throw new Error("Approval unexpectedly sends native value");

  const decoded = decodeFunctionData({ abi: erc20Abi, data: transaction.data as Hex });
  if (decoded.functionName !== "approve") throw new Error("Approval calldata is not approve()");
  const [spender, amount] = decoded.args;
  if (getAddress(spender) !== getAddress(swapTarget)) {
    throw new Error("Approval spender does not match the swap target");
  }
  if (amount !== exactApprovalAmount) {
    throw new Error("Approval amount is not the exact expected amount");
  }
}

export function requiredApprovalAmounts(
  currentAllowance: bigint,
  exactAmountIn: bigint,
): bigint[] {
  if (currentAllowance === exactAmountIn) return [];
  return currentAllowance === 0n ? [exactAmountIn] : [0n, exactAmountIn];
}

function approvalTransaction(
  wallet: Address,
  token: Address,
  spender: Address,
  amount: bigint,
): TransactionRequest {
  return {
    from: wallet,
    to: token,
    chainId: CHAIN_ID,
    value: "0",
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, amount],
    }),
  };
}
