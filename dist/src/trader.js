import { randomUUID } from "node:crypto";
import { createWalletClient, decodeFunctionData, formatUnits, getAddress, http, parseUnits, } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { erc20Abi, stonkBrokerAccountAbi } from "./abis.js";
import { BLOCKSCOUT_URL, CHAIN_ID, robinhoodChain } from "./constants.js";
import { TradeOutbox } from "./outbox.js";
import { XPublisher } from "./x.js";
const QUOTE_TTL_MS = 30_000;
export class StonkTrader {
    config;
    broker;
    uniswap;
    quotes = new Map();
    outbox;
    publisher;
    constructor(config, broker, uniswap, outbox, publisher) {
        this.config = config;
        this.broker = broker;
        this.uniswap = uniswap;
        this.outbox = outbox ?? new TradeOutbox(config.outboxPath);
        this.publisher = publisher ?? new XPublisher(config.xUserAccessToken, config.xDryRun);
    }
    async quoteTrade(input) {
        const uniswap = this.requireUniswap();
        const [identity, tokenIn, tokenOut] = await Promise.all([
            this.broker.identity(input.tokenId),
            this.broker.assets.resolve(input.tokenIn),
            this.broker.assets.resolve(input.tokenOut),
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
        if (amountIn <= 0n)
            throw new Error("Trade amount must be positive");
        if (amountIn > balance) {
            throw new Error(`Insufficient ${tokenIn.symbol}: requested ${input.amount}, balance ${formatUnits(balance, tokenInDecimals)}`);
        }
        if (amountIn * 10000n > balance * BigInt(this.config.maxTradeBps)) {
            throw new Error(`Trade exceeds MAX_TRADE_BPS (${this.config.maxTradeBps} bps of the current balance)`);
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
        const stored = {
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
    async executeTrade(quoteId) {
        this.assertLiveTradingReady();
        const quote = this.quotes.get(quoteId);
        if (!quote)
            throw new Error("Unknown quoteId; request a new quote");
        if (Date.now() > quote.expiresAt) {
            this.quotes.delete(quoteId);
            throw new Error("Quote expired; request a fresh quote");
        }
        const identity = await this.broker.identity(quote.tokenId);
        if (identity.wallet !== quote.wallet || identity.owner !== quote.owner) {
            throw new Error("StonkBroker ownership changed after the quote was created");
        }
        const privateKey = this.config.ownerPrivateKey;
        const account = privateKeyToAccount(privateKey);
        if (getAddress(account.address) !== identity.owner) {
            throw new Error(`OWNER_PRIVATE_KEY signs as ${account.address}, but StonkBroker #${quote.tokenId} is owned by ${identity.owner}`);
        }
        const uniswap = this.requireUniswap();
        const [swap, approvalPlan, inputBalanceBefore, outputBalanceBefore] = await Promise.all([
            uniswap.buildSwap(quote.envelope),
            uniswap.checkApproval({
                wallet: quote.wallet,
                token: quote.tokenIn.address,
                tokenOut: quote.tokenOut.address,
                amount: quote.amountIn,
            }),
            this.broker.tokenBalance(quote.wallet, quote.tokenIn.address),
            this.broker.tokenBalance(quote.wallet, quote.tokenOut.address),
        ]);
        validateSwapTransaction(swap, quote.wallet);
        if (quote.amountIn > inputBalanceBefore) {
            throw new Error("Input token balance fell below the quoted amount");
        }
        if (quote.amountIn * 10000n >
            inputBalanceBefore * BigInt(this.config.maxTradeBps)) {
            throw new Error("Trade now exceeds MAX_TRADE_BPS after a balance change");
        }
        const walletClient = createWalletClient({
            account,
            chain: robinhoodChain,
            transport: http(this.config.rpcUrl),
        });
        const approvalTxHashes = [];
        for (const transaction of [approvalPlan.cancel, approvalPlan.approval]) {
            if (!transaction)
                continue;
            validateApprovalTransaction(transaction, quote.wallet, quote.tokenIn.address, swap.to, quote.amountIn);
            approvalTxHashes.push(await this.executeTbaCall(transaction, quote.wallet, walletClient, account.address));
        }
        const txHash = await this.executeTbaCall(swap, quote.wallet, walletClient, account.address);
        const [inputBalanceAfter, outputBalanceAfter] = await Promise.all([
            this.broker.tokenBalance(quote.wallet, quote.tokenIn.address),
            this.broker.tokenBalance(quote.wallet, quote.tokenOut.address),
        ]);
        const amountIn = inputBalanceBefore - inputBalanceAfter;
        const amountOut = outputBalanceAfter - outputBalanceBefore;
        if (amountIn <= 0n || amountOut <= 0n) {
            throw new Error(`Swap ${txHash} confirmed but token balance deltas are invalid`);
        }
        const trade = {
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
        this.quotes.delete(quoteId);
        try {
            const result = await this.publisher.publish(trade);
            if (result.dryRun)
                throw new Error("X_DRY_RUN is enabled");
            await this.outbox.markPosted(trade.id, result.postId);
            return { trade, postStatus: "posted", xPostId: result.postId };
        }
        catch (error) {
            await this.outbox.markFailed(trade.id, error);
            return { trade, postStatus: "pending" };
        }
    }
    async flushPendingPosts() {
        return this.outbox.flush(this.publisher);
    }
    async executeTbaCall(transaction, wallet, walletClient, owner) {
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
        if (receipt.status !== "success")
            throw new Error(`Transaction ${hash} reverted`);
        return hash;
    }
    requireUniswap() {
        if (!this.uniswap)
            throw new Error("UNISWAP_API_KEY is not configured");
        return this.uniswap;
    }
    assertLiveTradingReady() {
        if (!this.config.allowLiveTrading) {
            throw new Error("Live trading is disabled; set ALLOW_LIVE_TRADING=true after reviewing the quote");
        }
        if (!this.config.ownerPrivateKey)
            throw new Error("OWNER_PRIVATE_KEY is not configured");
        if (this.config.requireXPost && (!this.config.xUserAccessToken || this.config.xDryRun)) {
            throw new Error("Live trading requires a real X_USER_ACCESS_TOKEN while REQUIRE_X_POST=true");
        }
    }
    pruneQuotes(now) {
        for (const [id, quote] of this.quotes) {
            if (quote.expiresAt < now)
                this.quotes.delete(id);
        }
    }
}
export function validateSwapTransaction(transaction, wallet) {
    if (transaction.chainId !== CHAIN_ID)
        throw new Error("Swap targets the wrong chain");
    if (getAddress(transaction.from) !== getAddress(wallet)) {
        throw new Error("Swap sender is not the StonkBroker TBA");
    }
    if (transaction.data === "0x")
        throw new Error("Swap calldata is empty");
}
export function validateApprovalTransaction(transaction, wallet, tokenIn, swapTarget, maxApprovalAmount) {
    if (transaction.chainId !== CHAIN_ID)
        throw new Error("Approval targets the wrong chain");
    if (getAddress(transaction.from) !== getAddress(wallet)) {
        throw new Error("Approval sender is not the StonkBroker TBA");
    }
    if (getAddress(transaction.to) !== getAddress(tokenIn)) {
        throw new Error("Approval target is not the input token");
    }
    if (BigInt(transaction.value) !== 0n)
        throw new Error("Approval unexpectedly sends native value");
    const decoded = decodeFunctionData({ abi: erc20Abi, data: transaction.data });
    if (decoded.functionName !== "approve")
        throw new Error("Approval calldata is not approve()");
    const [spender, amount] = decoded.args;
    if (getAddress(spender) !== getAddress(swapTarget)) {
        throw new Error("Approval spender does not match the swap target");
    }
    if (amount > maxApprovalAmount) {
        throw new Error("Approval amount exceeds the exact quoted input amount");
    }
}
//# sourceMappingURL=trader.js.map