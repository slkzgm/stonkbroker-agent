import "dotenv/config";

import { resolve } from "node:path";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";

import { DEFAULT_RPC_URL, DEFAULT_STONKBROKER_NFT } from "./constants.js";

const booleanFromEnv = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const optionalPrivateKey = z
  .string()
  .optional()
  .transform((value, context) => {
    if (!value) return undefined;
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
      context.addIssue({ code: "custom", message: "must be a 32-byte 0x-prefixed private key" });
      return z.NEVER;
    }
    return value as Hex;
  });

const addressFromEnv = z.string().transform((value, context) => {
  if (!isAddress(value)) {
    context.addIssue({ code: "custom", message: "must be a valid EVM address" });
    return z.NEVER;
  }
  return getAddress(value) as Address;
});

const envSchema = z.object({
  ROBINHOOD_RPC_URL: z.url().default(DEFAULT_RPC_URL),
  STONKBROKER_NFT_ADDRESS: addressFromEnv.default(DEFAULT_STONKBROKER_NFT),
  BROKER_TOKEN_ID: z.coerce.number().int().positive().optional(),
  UNISWAP_API_KEY: z.string().min(1).optional(),
  OWNER_PRIVATE_KEY: optionalPrivateKey,
  ALLOW_LIVE_TRADING: booleanFromEnv.default(false),
  MAX_TRADE_BPS: z.coerce.number().int().min(1).max(10_000).default(500),
  X_USER_ACCESS_TOKEN: z.string().min(1).optional(),
  REQUIRE_X_POST: booleanFromEnv.default(true),
  X_DRY_RUN: booleanFromEnv.default(false),
  OUTBOX_PATH: z.string().min(1).default(".stonkagent/outbox.json"),
  POST_RETRY_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000),
});

export interface AppConfig {
  rpcUrl: string;
  nftAddress: Address;
  defaultTokenId?: bigint;
  uniswapApiKey?: string;
  ownerPrivateKey?: Hex;
  allowLiveTrading: boolean;
  maxTradeBps: number;
  xUserAccessToken?: string;
  requireXPost: boolean;
  xDryRun: boolean;
  outboxPath: string;
  postRetryIntervalMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  return {
    rpcUrl: parsed.ROBINHOOD_RPC_URL,
    nftAddress: parsed.STONKBROKER_NFT_ADDRESS,
    ...(parsed.BROKER_TOKEN_ID === undefined
      ? {}
      : { defaultTokenId: BigInt(parsed.BROKER_TOKEN_ID) }),
    ...(parsed.UNISWAP_API_KEY === undefined
      ? {}
      : { uniswapApiKey: parsed.UNISWAP_API_KEY }),
    ...(parsed.OWNER_PRIVATE_KEY === undefined
      ? {}
      : { ownerPrivateKey: parsed.OWNER_PRIVATE_KEY }),
    allowLiveTrading: parsed.ALLOW_LIVE_TRADING,
    maxTradeBps: parsed.MAX_TRADE_BPS,
    ...(parsed.X_USER_ACCESS_TOKEN === undefined
      ? {}
      : { xUserAccessToken: parsed.X_USER_ACCESS_TOKEN }),
    requireXPost: parsed.REQUIRE_X_POST,
    xDryRun: parsed.X_DRY_RUN,
    outboxPath: resolve(parsed.OUTBOX_PATH),
    postRetryIntervalMs: parsed.POST_RETRY_INTERVAL_MS,
  };
}

export function resolveTokenId(config: AppConfig, tokenId?: number): bigint {
  if (tokenId !== undefined) return BigInt(tokenId);
  if (config.defaultTokenId !== undefined) return config.defaultTokenId;
  throw new Error("tokenId is required (or set BROKER_TOKEN_ID)");
}
