#!/usr/bin/env node
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const requiredTools = [
    "system_health",
    "broker_status",
    "list_stock_tokens",
    "quote_stock_trade",
    "execute_stock_trade",
    "retry_x_posts",
];
async function main() {
    if (process.argv.includes("--help")) {
        printUsage();
        return;
    }
    const options = parseArguments(process.argv.slice(2));
    const evidence = {
        schemaVersion: 1,
        startedAt: new Date().toISOString(),
        phase: "started",
    };
    const serverPath = fileURLToPath(new URL("./server.js", import.meta.url));
    const childEnvironment = Object.fromEntries(Object.entries(process.env).filter((entry) => entry[1] !== undefined));
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverPath],
        env: childEnvironment,
        cwd: process.cwd(),
        stderr: "inherit",
    });
    const client = new Client({ name: "stonkbroker-bounty-proof", version: "0.2.0" });
    try {
        await client.connect(transport);
        evidence.server = client.getServerVersion();
        const listedTools = await client.listTools();
        evidence.tools = listedTools.tools.map(({ name, description }) => ({
            name,
            ...(description ? { description } : {}),
        }));
        const availableNames = new Set(listedTools.tools.map((tool) => tool.name));
        const missingTools = requiredTools.filter((name) => !availableNames.has(name));
        if (missingTools.length > 0) {
            throw new Error(`MCP server is missing required tools: ${missingTools.join(", ")}`);
        }
        evidence.health = await callJsonTool(client, "system_health", {});
        evidence.broker = await callJsonTool(client, "broker_status", optionalTokenId(options));
        evidence.phase = "inspected";
        await saveEvidence(options.evidencePath, evidence);
        printStage("MCP inspection", {
            server: evidence.server,
            tools: evidence.tools.map((tool) => tool.name),
            health: evidence.health,
            broker: evidence.broker,
            evidencePath: options.evidencePath,
        });
        if (options.inspectOnly) {
            evidence.completedAt = new Date().toISOString();
            await saveEvidence(options.evidencePath, evidence);
            return;
        }
        assertLiveConfiguration(evidence.health);
        evidence.quote = await callJsonTool(client, "quote_stock_trade", {
            ...optionalTokenId(options),
            tokenIn: options.tokenIn,
            tokenOut: options.tokenOut,
            amount: options.amount,
            slippagePercent: options.slippagePercent,
        });
        evidence.phase = "quoted";
        await saveEvidence(options.evidencePath, evidence);
        printStage("Time-limited quote", evidence.quote);
        const quote = asRecord(evidence.quote, "quote result");
        const quoteId = stringField(quote, "quoteId");
        const terminal = createInterface({ input: stdin, output: stdout });
        const confirmation = await terminal.question("Review the quote above. Type EXECUTE to submit the irreversible mainnet trade: ");
        terminal.close();
        if (confirmation !== "EXECUTE") {
            evidence.phase = "cancelled";
            evidence.completedAt = new Date().toISOString();
            await saveEvidence(options.evidencePath, evidence);
            process.stdout.write("Trade cancelled; no transaction was submitted.\n");
            return;
        }
        evidence.execution = await callJsonTool(client, "execute_stock_trade", {
            quoteId,
            confirmation: "EXECUTE",
        });
        evidence.phase = "executed";
        evidence.completedAt = new Date().toISOString();
        await saveEvidence(options.evidencePath, evidence);
        printStage("Confirmed execution", evidence.execution);
        const execution = asRecord(evidence.execution, "execution result");
        if (execution.postStatus !== "posted" || typeof execution.xPostId !== "string") {
            throw new Error("The swap confirmed, but its X post is still pending. Keep the outbox and run retry_x_posts; do not execute another trade.");
        }
    }
    catch (error) {
        evidence.phase = "failed";
        evidence.completedAt = new Date().toISOString();
        evidence.failure = error instanceof Error ? error.message : String(error);
        await saveEvidence(options.evidencePath, evidence);
        throw error;
    }
    finally {
        await client.close().catch(() => undefined);
    }
}
async function callJsonTool(client, name, args) {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content.find((item) => item.type === "text");
    if (!text?.text)
        throw new Error(`MCP tool ${name} returned no text result`);
    let payload;
    try {
        payload = JSON.parse(text.text);
    }
    catch {
        throw new Error(`MCP tool ${name} returned invalid JSON`);
    }
    if (result.isError) {
        const record = payload && typeof payload === "object" ? payload : {};
        throw new Error(typeof record.error === "string" ? record.error : `MCP tool ${name} failed`);
    }
    return payload;
}
function assertLiveConfiguration(value) {
    const health = asRecord(value, "system_health result");
    const missing = [];
    if (health.quoteApiConfigured !== true)
        missing.push("UNISWAP_API_KEY");
    if (health.ownerSignerConfigured !== true)
        missing.push("OWNER_PRIVATE_KEY");
    if (health.liveTradingEnabled !== true)
        missing.push("ALLOW_LIVE_TRADING=true");
    if (health.xPostingConfigured !== true)
        missing.push("X_USER_ACCESS_TOKEN");
    if (health.requireXPost !== true)
        missing.push("REQUIRE_X_POST=true");
    if (health.xDryRun !== false)
        missing.push("X_DRY_RUN=false");
    if (missing.length > 0) {
        throw new Error(`Live-proof configuration is incomplete: ${missing.join(", ")}`);
    }
}
function parseArguments(args) {
    const values = new Map();
    let inspectOnly = false;
    for (let index = 0; index < args.length; index += 1) {
        const flag = args[index];
        if (flag === "--help")
            continue;
        if (flag === "--inspect-only") {
            inspectOnly = true;
            continue;
        }
        if (!flag.startsWith("--"))
            throw new Error(`Unexpected argument: ${flag}`);
        const value = args[index + 1];
        if (!value || value.startsWith("--"))
            throw new Error(`Missing value for ${flag}`);
        values.set(flag.slice(2), value);
        index += 1;
    }
    const known = new Set(["token-id", "in", "out", "amount", "slippage", "evidence"]);
    for (const name of values.keys()) {
        if (!known.has(name))
            throw new Error(`Unknown option: --${name}`);
    }
    const tokenIdRaw = values.get("token-id");
    const tokenId = tokenIdRaw === undefined ? undefined : Number(tokenIdRaw);
    if (tokenId !== undefined && (!Number.isSafeInteger(tokenId) || tokenId <= 0)) {
        throw new Error("--token-id must be a positive safe integer");
    }
    const slippagePercent = Number(values.get("slippage") ?? "0.5");
    if (!Number.isFinite(slippagePercent) || slippagePercent < 0.01 || slippagePercent > 5) {
        throw new Error("--slippage must be between 0.01 and 5 percent");
    }
    if (!inspectOnly) {
        for (const required of ["in", "out", "amount"]) {
            if (!values.get(required))
                throw new Error(`--${required} is required for a live proof`);
        }
    }
    const amount = values.get("amount");
    if (amount !== undefined && !/^\d+(\.\d+)?$/.test(amount)) {
        throw new Error("--amount must be a positive decimal string");
    }
    return {
        ...(tokenId === undefined ? {} : { tokenId }),
        ...(values.get("in") ? { tokenIn: values.get("in") } : {}),
        ...(values.get("out") ? { tokenOut: values.get("out") } : {}),
        ...(amount ? { amount } : {}),
        slippagePercent,
        evidencePath: resolve(values.get("evidence") ?? ".stonkagent/bounty-proof.json"),
        inspectOnly,
    };
}
function optionalTokenId(options) {
    return options.tokenId === undefined ? {} : { tokenId: options.tokenId };
}
function asRecord(value, name) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${name} is not an object`);
    }
    return value;
}
function stringField(record, field) {
    const value = record[field];
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`Result is missing ${field}`);
    }
    return value;
}
async function saveEvidence(path, evidence) {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, path);
}
function printStage(name, value) {
    process.stdout.write(`\n=== ${name} ===\n${JSON.stringify(value, null, 2)}\n`);
}
function printUsage() {
    process.stdout.write([
        "Usage:",
        "  stonkbroker-proof --inspect-only [--token-id 1] [--evidence path]",
        "  stonkbroker-proof --token-id 123 --in AAPL --out NVDA --amount 0.001 [--slippage 0.5] [--evidence path]",
        "",
        "The live flow starts the real MCP server, captures public evidence, and requires typing EXECUTE after reviewing the quote.",
        "Secrets are read only from the local environment and are never written to the evidence file.",
    ].join("\n") + "\n");
}
await main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
//# sourceMappingURL=proof.js.map