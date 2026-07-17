/**
 * End-to-end smoke test — `npm run smoke` (or npx tsx scripts/smoke.ts).
 *
 * a) Gamma markets parse + tradability filter
 * b) News wires (BBC general + Google News targeted), freshness < 48h
 * c) Risk gate mirror follows policy/risk.yaml (edit the yaml → test follows)
 * d) markToMarket fixed case
 * e) claude CLI present (engine) + MCP server handshake (5 tools)
 * f) soft: real headless claude -p round-trip (needs a logged-in Claude Code)
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined && m[2] !== "") {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));

const CLAUDE_BIN = process.env.VERITAS_CLAUDE_BIN ?? "claude";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  soft?: boolean;
}
const results: CheckResult[] = [];

async function check(
  name: string,
  fn: () => Promise<string>,
  opts: { soft?: boolean } = {}
): Promise<void> {
  try {
    results.push({ name, ok: true, detail: await fn(), soft: opts.soft });
  } catch (err) {
    results.push({
      name,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      soft: opts.soft,
    });
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

/** Minimal JSON-RPC-over-stdio handshake against the bundled MCP server —
 * the exact artifact the runtime uses (.veritas/mcp-server.cjs, built by
 * the presmoke hook). */
async function mcpHandshake(): Promise<string[]> {
  const bundle = path.join(process.cwd(), ".veritas", "mcp-server.cjs");
  assert(fs.existsSync(bundle), "bundle missing — run `npm run mcp:build`");
  const child = spawn(process.execPath, [bundle], { cwd: process.cwd() });
  const send = (obj: unknown) => child.stdin.write(`${JSON.stringify(obj)}\n`);

  try {
    return await new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("mcp handshake timeout (20s)")), 20_000);
      let buffer = "";
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as {
              id?: number;
              result?: { tools?: { name: string }[] };
            };
            if (msg.id === 1) {
              send({ jsonrpc: "2.0", method: "notifications/initialized" });
              send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
            } else if (msg.id === 2) {
              clearTimeout(timer);
              resolve((msg.result?.tools ?? []).map((t) => t.name));
            }
          } catch {
            /* non-JSON noise */
          }
        }
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "veritas-smoke", version: "0" },
        },
      });
    });
  } finally {
    child.kill();
  }
}

async function main(): Promise<void> {
  const { topMarkets, searchMarkets } = await import("../src/lib/sources/polymarket");
  const { fetchNews } = await import("../src/lib/sources/news");
  const { gateExecuteTrade, loadPolicy } = await import("../src/lib/risk/gate");
  const { markToMarket } = await import("../src/lib/portfolio");

  await check("gamma top markets", async () => {
    const { markets } = await topMarkets({ limit: 10 });
    assert(markets.length >= 5, `only ${markets.length} tradable markets`);
    for (const m of markets) {
      assert(m.yesPrice > 0 && m.yesPrice < 1, `bad yes price ${m.yesPrice} on ${m.id}`);
      assert(new Date(m.endDate).getTime() > Date.now(), `expired market ${m.id}`);
    }
    return `${markets.length} tradable binary markets, top vol24h=${Math.round(markets[0].volume24h)}`;
  });

  await check("gamma search", async () => {
    const { markets } = await searchMarkets("election");
    return `${markets.length} open markets for "election"`;
  });

  await check("news wire (BBC)", async () => {
    const news = await fetchNews({});
    assert(news.items.length >= 5, `only ${news.items.length} items`);
    const fresh = news.items.filter((i) => {
      const t = new Date(i.published).getTime();
      return !Number.isNaN(t) && Date.now() - t < 48 * 3600 * 1000;
    });
    assert(fresh.length >= 5, `only ${fresh.length} items fresher than 48h`);
    return `${news.items.length} items, ${fresh.length} < 48h old`;
  });

  await check("news wire (Google News topic)", async () => {
    const news = await fetchNews({ topic: "oil prices" });
    assert(news.items.length >= 1, "no targeted headlines");
    return `${news.items.length} items for "oil prices"`;
  });

  await check("risk gate follows policy/risk.yaml", async () => {
    const policy = loadPolicy();
    const max = policy.risk_officer.execute_trade.max_stake_usd;
    const over = await gateExecuteTrade({
      market_id: "smoke",
      side: "YES",
      size_usd: max * 2.4,
    });
    assert(over.decision === "DENY", `expected DENY above cap, got ${over.decision}`);
    assert(over.max_stake_usd === max, "decision cap does not match yaml");
    const under = await gateExecuteTrade({
      market_id: "smoke",
      side: "YES",
      size_usd: max * 0.8,
    });
    assert(under.decision === "ALLOW", `expected ALLOW under cap, got ${under.decision}`);
    return `cap $${max.toFixed(2)} from yaml — DENY at $${(max * 2.4).toFixed(2)}, ALLOW at $${(max * 0.8).toFixed(2)} (${over.source})`;
  });

  await check("markToMarket", async () => {
    const pnl = markToMarket(5, 0.4, 0.55);
    assert(Math.abs(pnl - 1.875) < 1e-9, `expected 1.875, got ${pnl}`);
    return "YES $5 @40¢ → 55¢ = +$1.875";
  });

  await check("claude CLI (engine)", async () => {
    const res = spawnSync(CLAUDE_BIN, ["--version"], { encoding: "utf8" });
    assert(
      res.status === 0,
      `\`${CLAUDE_BIN} --version\` failed: ${res.stderr || res.error?.message || `exit ${res.status}`}`
    );
    return res.stdout.trim();
  });

  await check("mcp server handshake", async () => {
    const tools = await mcpHandshake();
    assert(tools.length === 5, `expected 5 tools, got ${tools.length}: ${tools.join(", ")}`);
    return `5 MCP tools: ${tools.join(", ")}`;
  });

  await check(
    "claude headless round-trip",
    async () => {
      const res = spawnSync(
        CLAUDE_BIN,
        [
          "-p",
          "Reply with exactly: OK",
          "--output-format",
          "json",
          "--max-budget-usd",
          "0.50",
          "--no-session-persistence",
          "--strict-mcp-config",
        ],
        { encoding: "utf8", timeout: 90_000 }
      );
      assert(res.status === 0, `exit ${res.status}: ${(res.stderr || "").slice(0, 300)}`);
      const parsed = JSON.parse(res.stdout) as {
        is_error?: boolean;
        errors?: string[];
        subtype?: string;
        total_cost_usd?: number;
      };
      assert(
        parsed.is_error === false,
        `result is_error (${parsed.subtype}): ${parsed.errors?.join("; ")}`
      );
      return `session OK — cost=$${parsed.total_cost_usd?.toFixed(2) ?? "?"}`;
    },
    { soft: true }
  );

  let hardFailures = 0;
  console.log("\nVERITAS smoke:");
  for (const r of results) {
    const mark = r.ok ? "PASS" : r.soft ? "WARN" : "FAIL";
    if (!r.ok && !r.soft) hardFailures += 1;
    console.log(`  [${mark}] ${r.name} — ${r.detail}`);
  }
  if (results.some((r) => !r.ok && r.soft)) {
    console.log("  (WARN = the headless round-trip needs a logged-in Claude Code session)");
  }
  process.exit(hardFailures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
