import { encodeFunctionData, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { erc20Abi } from "../src/abis.js";
import type { TransactionRequest } from "../src/types.js";
import { validateApprovalTransaction, validateSwapTransaction } from "../src/trader.js";

const wallet = "0x0000000000000000000000000000000000000001" as Address;
const token = "0x0000000000000000000000000000000000000002" as Address;
const router = "0x0000000000000000000000000000000000000003" as Address;

function approval(amount: bigint, spender = router): TransactionRequest {
  return {
    from: wallet,
    to: token,
    chainId: 4663,
    value: "0",
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, amount],
    }),
  };
}

describe("transaction validation", () => {
  it("accepts an exact direct approval and rejects an unlimited approval", () => {
    expect(() => validateApprovalTransaction(approval(100n), wallet, token, router, 100n)).not.toThrow();
    expect(() =>
      validateApprovalTransaction(approval(101n), wallet, token, router, 100n),
    ).toThrow("exceeds");
  });

  it("rejects approvals to a different spender", () => {
    expect(() =>
      validateApprovalTransaction(
        approval(100n, "0x0000000000000000000000000000000000000004"),
        wallet,
        token,
        router,
        100n,
      ),
    ).toThrow("spender");
  });

  it("requires the TBA to be the swap sender", () => {
    const swap: TransactionRequest = {
      from: "0x0000000000000000000000000000000000000004",
      to: router,
      chainId: 4663,
      value: "0",
      data: "0x1234",
    };
    expect(() => validateSwapTransaction(swap, wallet)).toThrow("sender");
  });
});
