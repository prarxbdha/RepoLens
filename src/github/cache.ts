/** Small bounded LRU cache for read-only GitHub responses. */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class BoundedResponseCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  hits = 0;
  misses = 0;

  constructor(ttlMs: number, maxEntries: number) {
    this.ttlMs = Math.max(0, ttlMs);
    this.maxEntries = Math.max(0, Math.floor(maxEntries));
  }

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      this.misses += 1;
      return undefined;
    }
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(key);
      this.misses += 1;
      return undefined;
    }
    // Refresh LRU order on every successful lookup.
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits += 1;
    return entry.value as T;
  }

  set<T>(key: string, value: T): void {
    if (this.maxEntries === 0 || this.ttlMs === 0) return;
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Authentication bucket only; the token itself is never part of a key or log. */
export function authBucket(token: string | undefined): string {
  return token === undefined ? "anon" : "auth";
}

export function cacheKey(
  scope: string,
  bucket: string,
  path: string,
  query: Record<string, string | number | boolean | undefined>,
): string {
  const normalized = Object.entries(query)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `${scope}|${bucket}|${path}${normalized === "" ? "" : `?${normalized}`}`;
}
