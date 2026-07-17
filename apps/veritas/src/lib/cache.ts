/**
 * Last-good cache + source status registry.
 *
 * The honesty contract: a failed live fetch never gets masked. Either the
 * last REAL response is served, labeled `cached` with its timestamp (in the
 * UI chip AND in the note handed to the agent), or the source is `down` and
 * the failure propagates. There are no embedded fixtures anywhere.
 */
import type { Emit, SourceName, SourceState, SourceStatus } from "./sse";
import { nowIso } from "./sse";

interface CachedValue {
  data: unknown;
  fetchedAt: string;
}

const lastGood = new Map<string, CachedValue>();
const statuses = new Map<SourceName, SourceStatus>();

export function setStatus(
  source: SourceName,
  status: SourceState,
  detail?: string,
  emit?: Emit
): void {
  const entry: SourceStatus = { status, ts: nowIso(), detail };
  statuses.set(source, entry);
  emit?.({ type: "source_status", source, status, ts: entry.ts, detail });
}

export function getStatuses(): Record<string, SourceStatus> {
  return Object.fromEntries(statuses);
}

export interface CachedFetch<T> {
  data: T;
  fresh: boolean;
  fetchedAt: string;
  /** Present when serving cache — also forwarded verbatim to the agent. */
  note?: string;
}

export async function fetchWithCache<T>(opts: {
  source: SourceName;
  key: string;
  emit?: Emit;
  fn: () => Promise<T>;
}): Promise<CachedFetch<T>> {
  try {
    const data = await opts.fn();
    const fetchedAt = nowIso();
    lastGood.set(opts.key, { data, fetchedAt });
    setStatus(opts.source, "live", undefined, opts.emit);
    return { data, fresh: true, fetchedAt };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const cached = lastGood.get(opts.key);
    if (cached) {
      setStatus(opts.source, "cached", `last good ${cached.fetchedAt}`, opts.emit);
      return {
        data: cached.data as T,
        fresh: false,
        fetchedAt: cached.fetchedAt,
        note: `cached data from ${cached.fetchedAt} — live fetch failed (${detail})`,
      };
    }
    setStatus(opts.source, "down", detail, opts.emit);
    throw err;
  }
}
