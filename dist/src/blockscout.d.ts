import { type Address } from "viem";
import type { PortfolioPosition, RobinhoodAsset } from "./types.js";
export declare function fetchCanonicalPortfolio(wallet: Address, canonicalAssets: Map<string, RobinhoodAsset>, fetcher?: typeof fetch): Promise<PortfolioPosition[]>;
