import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { TradePost } from "./types.js";
import type { XPublisher } from "./x.js";

interface OutboxFile {
  version: 1;
  posts: TradePost[];
}

export class TradeOutbox {
  private writeLock: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async enqueue(post: TradePost): Promise<void> {
    await this.mutate((file) => {
      if (!file.posts.some((candidate) => candidate.txHash === post.txHash)) {
        file.posts.push(post);
      }
    });
  }

  async pending(): Promise<TradePost[]> {
    return (await this.read()).posts.filter((post) => !post.postedAt);
  }

  async markPosted(id: string, postId: string): Promise<void> {
    await this.mutate((file) => {
      const post = file.posts.find((candidate) => candidate.id === id);
      if (!post) throw new Error(`Outbox post ${id} was not found`);
      post.postedAt = new Date().toISOString();
      post.xPostId = postId;
      post.attempts += 1;
      delete post.lastError;
    });
  }

  async markFailed(id: string, error: unknown): Promise<void> {
    await this.mutate((file) => {
      const post = file.posts.find((candidate) => candidate.id === id);
      if (!post) return;
      post.attempts += 1;
      post.lastError = error instanceof Error ? error.message : String(error);
    });
  }

  async flush(publisher: XPublisher): Promise<{
    posted: number;
    failed: number;
    remaining: number;
  }> {
    let posted = 0;
    let failed = 0;
    const pending = await this.pending();
    for (const trade of pending) {
      try {
        const result = await publisher.publish(trade);
        if (result.dryRun) {
          throw new Error("X_DRY_RUN is enabled; post remains queued");
        }
        await this.markPosted(trade.id, result.postId);
        posted += 1;
      } catch (error) {
        await this.markFailed(trade.id, error);
        failed += 1;
      }
    }
    return { posted, failed, remaining: (await this.pending()).length };
  }

  private async read(): Promise<OutboxFile> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as OutboxFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.posts)) {
        throw new Error("Unsupported outbox format");
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, posts: [] };
      }
      throw error;
    }
  }

  private async mutate(mutation: (file: OutboxFile) => void): Promise<void> {
    const operation = this.writeLock.then(async () => {
      const file = await this.read();
      mutation(file);
      await mkdir(dirname(this.path), { recursive: true });
      const temporaryPath = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
      await rename(temporaryPath, this.path);
    });
    this.writeLock = operation.catch(() => undefined);
    await operation;
  }
}
