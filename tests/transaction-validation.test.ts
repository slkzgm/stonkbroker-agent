import {
  encodeAbiParameters,
  encodeFunctionData,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";
import { describe, expect, it } from "vitest";

import { erc20Abi, uniswapSwapProxyAbi } from "../src/abis.js";
import { UNISWAP_SWAP_PROXY, UNISWAP_UNIVERSAL_ROUTER } from "../src/constants.js";
import type { TransactionRequest } from "../src/types.js";
import {
  requiredApprovalAmounts,
  validateApprovalTransaction,
  validateSwapTransaction,
} from "../src/trader.js";

const wallet = "0x0000000000000000000000000000000000000010" as Address;
const token = "0x0000000000000000000000000000000000000020" as Address;
const outputToken = "0x0000000000000000000000000000000000000030" as Address;
const spender = UNISWAP_SWAP_PROXY;
const v3ExactInputParameters = parseAbiParameters(
  "address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser, uint256[] minHopPriceX36",
);

function approval(amount: bigint, approvalSpender = spender): TransactionRequest {
  return {
    from: wallet,
    to: token,
    chainId: 4663,
    value: "0",
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [approvalSpender, amount],
    }),
  };
}

function swap(overrides: {
  from?: Address;
  to?: Address;
  value?: string;
  router?: Address;
  inputToken?: Address;
  amount?: bigint;
  deadline?: bigint;
  recipient?: Address;
  commands?: Hex;
  routeInputs?: readonly Hex[];
} = {}): TransactionRequest {
  const commands = overrides.commands ?? "0x00";
  const inputs = overrides.routeInputs ?? [
    encodeAbiParameters(v3ExactInputParameters, [
      overrides.recipient ?? wallet,
      overrides.amount ?? 100n,
      1n,
      `${token}000bb8${outputToken.slice(2)}` as Hex,
      false,
      [],
    ]),
  ];
  return {
    from: overrides.from ?? wallet,
    to: overrides.to ?? UNISWAP_SWAP_PROXY,
    chainId: 4663,
    value: overrides.value ?? "0",
    data: encodeFunctionData({
      abi: uniswapSwapProxyAbi,
      functionName: "execute",
      args: [
        overrides.router ?? UNISWAP_UNIVERSAL_ROUTER,
        overrides.inputToken ?? token,
        overrides.amount ?? 100n,
        commands,
        inputs,
        overrides.deadline ?? 1_120n,
      ],
    }),
  };
}

describe("transaction validation", () => {
  it("accepts an exact direct approval and rejects an unlimited approval", () => {
    expect(() => validateApprovalTransaction(approval(100n), wallet, token, spender, 100n)).not.toThrow();
    expect(() =>
      validateApprovalTransaction(approval(101n), wallet, token, spender, 100n),
    ).toThrow("exact");
  });

  it("rejects approvals to a different spender", () => {
    expect(() =>
      validateApprovalTransaction(
        approval(100n, "0x0000000000000000000000000000000000000004"),
        wallet,
        token,
        spender,
        100n,
      ),
    ).toThrow("spender");
  });

  it("accepts only the official proxy and Universal Router 2.1.1 route", () => {
    expect(() =>
      validateSwapTransaction(swap(), wallet, token, outputToken, 100n, 1_000n),
    ).not.toThrow();
    expect(() =>
      validateSwapTransaction(
        swap({ to: "0x0000000000000000000000000000000000000004" }),
        wallet,
        token,
        outputToken,
        100n,
        1_000n,
      ),
    ).toThrow("official");
    expect(() =>
      validateSwapTransaction(
        swap({ router: "0x0000000000000000000000000000000000000004" }),
        wallet,
        token,
        outputToken,
        100n,
        1_000n,
      ),
    ).toThrow("2.1.1");
  });

  it("binds the proxy calldata to the exact token, amount, deadline, and zero value", () => {
    expect(() =>
      validateSwapTransaction(swap({ amount: 101n }), wallet, token, outputToken, 100n, 1_000n),
    ).toThrow("amount");
    expect(() =>
      validateSwapTransaction(swap({ deadline: 999n }), wallet, token, outputToken, 100n, 1_000n),
    ).toThrow("deadline");
    expect(() =>
      validateSwapTransaction(swap({ value: "1" }), wallet, token, outputToken, 100n, 1_000n),
    ).toThrow("native value");
  });

  it("requires the TBA to be the swap sender", () => {
    expect(() =>
      validateSwapTransaction(
        swap({ from: "0x0000000000000000000000000000000000000004" }),
        wallet,
        token,
        outputToken,
        100n,
        1_000n,
      ),
    ).toThrow("sender");
  });

  it("requires the output token to be delivered explicitly to the TBA", () => {
    expect(() =>
      validateSwapTransaction(
        swap({ recipient: "0x0000000000000000000000000000000000000040" }),
        wallet,
        token,
        outputToken,
        100n,
        1_000n,
      ),
    ).toThrow("recipient");
    expect(() =>
      validateSwapTransaction(
        swap({ recipient: "0x0000000000000000000000000000000000000001" }),
        wallet,
        token,
        outputToken,
        100n,
        1_000n,
      ),
    ).toThrow("recipient");
    expect(() =>
      validateSwapTransaction(
        swap({ recipient: "0x0000000000000000000000000000000000000002" }),
        wallet,
        token,
        outputToken,
        100n,
        1_000n,
      ),
    ).toThrow("does not deliver");
  });

  it("rejects allow-revert router commands", () => {
    expect(() =>
      validateSwapTransaction(
        swap({ commands: "0x80" }),
        wallet,
        token,
        outputToken,
        100n,
        1_000n,
      ),
    ).toThrow("allow-revert");
  });

  it("accepts a V4 exact-input plan only when TAKE sends the full output delta to the TBA", () => {
    const v4Plan = (recipient: Address, amount = 0n) =>
      encodeAbiParameters(commandsAndInputs(), [
        "0x060b0e",
        [
          "0x01",
          encodeAbiParameters(
            parseAbiParameters("address currency, uint256 amount, bool payerIsUser"),
            [token, 100n, false],
          ),
          encodeAbiParameters(
            parseAbiParameters("address currency, address recipient, uint256 amount"),
            [outputToken, recipient, amount],
          ),
        ],
      ]);

    expect(() =>
      validateSwapTransaction(
        swap({ commands: "0x10", routeInputs: [v4Plan(wallet)] }),
        wallet,
        token,
        outputToken,
        100n,
        1_000n,
      ),
    ).not.toThrow();
    expect(() =>
      validateSwapTransaction(
        swap({ commands: "0x10", routeInputs: [v4Plan(wallet, 1n)] }),
        wallet,
        token,
        outputToken,
        100n,
        1_000n,
      ),
    ).toThrow("complete open delta");
  });

  it("plans an exact allowance and clears any mismatched existing allowance first", () => {
    expect(requiredApprovalAmounts(0n, 100n)).toEqual([100n]);
    expect(requiredApprovalAmounts(100n, 100n)).toEqual([]);
    expect(requiredApprovalAmounts(50n, 100n)).toEqual([0n, 100n]);
    expect(requiredApprovalAmounts(1_000n, 100n)).toEqual([0n, 100n]);
  });
});

function commandsAndInputs() {
  return parseAbiParameters("bytes commands, bytes[] inputs");
}
