import { ApiError } from "../errors/api-error.js";
interface Entry {
  count: number;
  expiresAt: number;
}

export class FixedWindowStore {
  private readonly entries = new Map<string, Entry>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(
    private readonly maxKeys: number,
    cleanupIntervalMs = 60_000,
  ) {
    this.cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs);
    this.cleanupTimer.unref();
  }
  consume(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): void {
    this.cleanup(now);
    const current = this.entries.get(key);
    if (!current && this.entries.size >= this.maxKeys)
      throw this.limited(windowMs);
    const entry = current ?? { count: 0, expiresAt: now + windowMs };
    if (entry.count >= limit)
      throw this.limited(Math.max(1, entry.expiresAt - now));
    entry.count += 1;
    this.entries.set(key, entry);
  }
  clear(key: string): void {
    this.entries.delete(key);
  }
  reset(): void {
    this.entries.clear();
  }
  dispose(): void {
    clearInterval(this.cleanupTimer);
  }
  get size(): number {
    return this.entries.size;
  }
  cleanup(now = Date.now()): void {
    for (const [key, entry] of this.entries)
      if (entry.expiresAt <= now) this.entries.delete(key);
  }
  private limited(retryMs: number): ApiError {
    return new ApiError(
      429,
      "RATE_LIMITED",
      "请求过于频繁，请稍后再试",
      undefined,
      { "Retry-After": String(Math.ceil(retryMs / 1000)) },
    );
  }
}
