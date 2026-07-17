/**
 * End-to-end smoke test — `npm run smoke` (or npx tsx scripts/smoke.ts).
 *
 * a) Gamma markets parse + tradability filter
 * b) News wires (BBC general + Google News targeted), freshness < 48h
 * c) Risk gate mirror follows policy/risk.yaml (edit the yaml → test follows)
 * d) markToMarket fixed case
 * e) Anthropic ping: forced tool call round-trip (skipped without credentials)
 */
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

  await check(
    "anthropic tool-use ping",
    async () => {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic();
      const model = process.env.VERITAS_MODEL ?? "claude-opus-4-8";
      const response = await client.messages.create({
        model,
        max_tokens: 256,
        tools: [
          {
            name: "ping",
            description: "Reply with a pong.",
            input_schema: {
              type: "object",
              properties: { pong: { type: "boolean" } },
              required: ["pong"],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: { type: "tool", name: "ping" },
        messages: [{ role: "user", content: "ping" }],
      });
      assert(response.stop_reason === "tool_use", `stop_reason=${response.stop_reason}`);
      return `${model} answered with a tool call`;
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
    console.log("  (WARN = agent credentials missing/unreachable; RUN AGENT needs ANTHROPIC_API_KEY)");
  }
  process.exit(hardFailures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
