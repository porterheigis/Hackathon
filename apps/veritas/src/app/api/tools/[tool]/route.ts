import { getActiveRun } from "@/lib/agent/run-registry";
import { executeTool, TOOL_DEFS, type RunState } from "@/lib/agent/tools";
import { tapeLine, type Emit, type TapeKind } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_TOOLS = new Set(TOOL_DEFS.map((t) => t.name));

/**
 * Backend of the MCP relay: executes a tool server-side and narrates it on
 * the active run's tape. Callable without an active run too (debug) — it
 * then executes silently.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ tool: string }> }
) {
  const { tool } = await params;
  if (!VALID_TOOLS.has(tool)) {
    return Response.json(
      { ok: false, result: { error: "unknown_tool", tool } },
      { status: 404 }
    );
  }

  const input = await req.json().catch(() => ({}));
  const run = getActiveRun();
  const emit: Emit = run?.emit ?? (() => {});
  const state: RunState = run?.state ?? { trades: 0, denials: 0 };

  tapeLine(emit, "tool_call", JSON.stringify(input), { tool, payload: input });
  const outcome = await executeTool(tool, input, { emit, run: state });
  const kind: TapeKind = outcome.deny ? "deny" : outcome.ok ? "tool_result" : "error";
  tapeLine(emit, kind, JSON.stringify(outcome.result), { tool, payload: outcome.result });

  return Response.json(outcome);
}
