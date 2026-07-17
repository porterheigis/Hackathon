/**
 * VERITAS MCP server (stdio) — the bridge between the headless Claude Code
 * session and the Next server. Pure relay: every tool call is POSTed to
 * /api/tools/<name>, where the real logic (Pomerium gate, fills, Nexla
 * journal, tape events) lives. No state here.
 *
 * Launched by Claude Code via --mcp-config; VERITAS_BASE_URL points at the
 * running Next server (default http://localhost:3001).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  ExecuteTradeInput,
  FetchNewsInput,
  GetMarketInput,
  GetPortfolioInput,
  SearchMarketsInput,
} from "../src/lib/schemas";
import { TOOL_DEFS } from "../src/lib/agent/tools";

const BASE_URL = process.env.VERITAS_BASE_URL ?? "http://localhost:3001";

const SHAPES: Record<string, z.ZodRawShape> = {
  fetch_news: FetchNewsInput.shape,
  search_markets: SearchMarketsInput.shape,
  get_market: GetMarketInput.shape,
  execute_trade: ExecuteTradeInput.shape,
  get_portfolio: GetPortfolioInput.shape,
};

async function relay(name: string, input: unknown) {
  try {
    const res = await fetch(`${BASE_URL}/api/tools/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input ?? {}),
      signal: AbortSignal.timeout(30_000),
    });
    const outcome = (await res.json()) as { ok?: boolean; result?: unknown };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(outcome.result ?? outcome) }],
      isError: outcome.ok === false,
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: "veritas server unreachable",
            detail: err instanceof Error ? err.message : String(err),
            base_url: BASE_URL,
          }),
        },
      ],
      isError: true,
    };
  }
}

async function main(): Promise<void> {
  const server = new McpServer({ name: "veritas", version: "0.1.0" });
  for (const def of TOOL_DEFS) {
    server.tool(def.name, def.description, SHAPES[def.name] ?? {}, async (args) =>
      relay(def.name, args)
    );
  }
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
