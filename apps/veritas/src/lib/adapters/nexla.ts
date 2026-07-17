/**
 * Nexla journal — every signal and fill is journaled via MCP tools/call
 * when NEXLA_SERVICE_KEY is set (JSON-RPC surface, responses zod-validated).
 * Without credentials, entries land in a local journal shown as MIRROR.
 * A live failure flips the chip to DOWN — never masked.
 *
 * Fire-and-forget by design: journaling must not block the trading loop.
 */
import { setStatus } from "../cache";
import { NexlaRpcResponseSchema } from "../schemas";
import type { Emit } from "../sse";
import { nowIso } from "../sse";

export interface JournalEntry {
  tool: "log_signal" | "record_fill";
  args: Record<string, unknown>;
  ts: string;
  source: "nexla-live" | "local-journal";
}

const journal: JournalEntry[] = [];

export function getJournal(): JournalEntry[] {
  return [...journal];
}

async function callNexla(
  tool: JournalEntry["tool"],
  args: Record<string, unknown>,
  emit?: Emit
): Promise<void> {
  const key = process.env.NEXLA_SERVICE_KEY;
  if (!key) {
    journal.push({ tool, args, ts: nowIso(), source: "local-journal" });
    setStatus("nexla", "mirror", `local journal (${journal.length} entries)`, emit);
    return;
  }
  const base =
    process.env.NEXLA_MCP_URL ?? `https://api-genai.nexla.io/mcp/service_key/${key}`;
  try {
    const res = await fetch(base, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`nexla ${res.status}`);
    const parsed = NexlaRpcResponseSchema.parse(await res.json());
    if (parsed.error) throw new Error(`nexla rpc error: ${JSON.stringify(parsed.error)}`);
    journal.push({ tool, args, ts: nowIso(), source: "nexla-live" });
    setStatus("nexla", "live", `journaled ${tool}`, emit);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    journal.push({ tool, args, ts: nowIso(), source: "local-journal" });
    setStatus("nexla", "down", detail, emit);
  }
}

export function logSignal(
  args: { market_id: string; side: string; thesis: string },
  emit?: Emit
): void {
  void callNexla("log_signal", args, emit);
}

export function recordFill(
  args: { market_id: string; side: string; size_usd: number; price: number },
  emit?: Emit
): void {
  void callNexla("record_fill", args, emit);
}
