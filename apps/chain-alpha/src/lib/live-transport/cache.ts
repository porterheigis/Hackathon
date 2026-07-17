/**
 * Tiny in-memory TTL cache.
 *
 * Purpose: avoid reconnecting to AISStream / re-fetching ADSB.lol on every render or poll.
 * Snapshots and provider results are cached for LIVE_TRANSPORT_CACHE_SECONDS (default 15).
 * This is a best-effort, per-process cache — it is never a source of truth and is safe to
 * lose. Using Date.now() here is fine (it only gates network freshness, not replay motion).
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

export function defaultCacheSeconds(): number {
  const raw = process.env.LIVE_TRANSPORT_CACHE_SECONDS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 15;
}

export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function setCached<T>(key: string, value: T, ttlSeconds?: number): void {
  const ttl = ttlSeconds ?? defaultCacheSeconds();
  store.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
}

/** Test/utility helper — drop all cached entries. */
export function clearCache(): void {
  store.clear();
}
