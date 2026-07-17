/**
 * The agent runner — spawns a headless Claude Code session
 * (`claude -p … --output-format stream-json --include-partial-messages`)
 * and bridges its NDJSON stream onto the live tape.
 *
 * Adapted from the batch-seo.ts orchestration pattern, minus what headless
 * makes unnecessary: no Terminal window, no output-file polling, no
 * kill-by-tty — the -p process exits by itself and NDJSON is the channel.
 * What survives: a short kickoff prompt, an orchestrator-side deadline, and
 * a systematic kill when the deadline hits.
 *
 * Tool calls do NOT flow through this stream: Claude Code calls the
 * mcp__veritas__* tools (scripts/veritas-mcp.ts), which relay to
 * /api/tools/* in this server — those routes emit the tool_call /
 * tool_result / deny tape lines with full payloads.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { setStatus } from "../cache";
import { snapshot } from "../portfolio";
import { nowIso, tapeLine } from "../sse";
import type { ActiveRun } from "./run-registry";
import { buildSystemPrompt } from "./system-prompt";
import { TOOL_DEFS } from "./tools";

const DEFAULT_TIMEOUT_MS = 240_000;

interface StreamLine {
  type?: string;
  subtype?: string;
  model?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  tools?: string[];
  mcp_servers?: { name: string; status: string }[];
  event?: {
    type?: string;
    index?: number;
    delta?: { type?: string; text?: string; thinking?: string };
  };
  is_error?: boolean;
  errors?: string[];
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
}

/**
 * The MCP server runs as a PRE-BUNDLED plain-JS file (npm run mcp:build,
 * auto-run by predev/prestart) launched with the node binary directly.
 * Running it via `npx tsx` loses a startup race: `claude -p` snapshots its
 * tool set ~immediately, before a ~2s tsx cold start finishes the MCP
 * handshake — the session then runs with zero tools. The bundle connects in
 * ~100ms and reliably wins that race.
 */
export function mcpBundlePath(): string {
  return path.join(process.cwd(), ".veritas", "mcp-server.cjs");
}

function buildMcpConfig(): string {
  const baseUrl = process.env.VERITAS_BASE_URL ?? "http://localhost:3001";
  return JSON.stringify({
    mcpServers: {
      veritas: {
        command: process.execPath,
        args: [mcpBundlePath()],
        env: { VERITAS_BASE_URL: baseUrl },
      },
    },
  });
}

export async function runAgent(run: ActiveRun): Promise<void> {
  const { emit, state } = run;
  const claudeBin = process.env.VERITAS_CLAUDE_BIN ?? "claude";
  const model = process.env.VERITAS_MODEL ?? "opus";
  const budgetUsd = process.env.VERITAS_MAX_BUDGET_USD ?? "5";
  const timeoutMs = Number(process.env.VERITAS_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const bankroll = snapshot().walletUsd;
  const startedAt = Date.now();

  if (!existsSync(mcpBundlePath())) {
    const detail = "MCP bundle missing — run `npm run mcp:build` (auto-run by npm run dev/start)";
    setStatus("anthropic", "down", detail, emit);
    emit({ type: "run_error", message: detail });
    emit({ type: "done" });
    return;
  }

  const allowedTools = TOOL_DEFS.map((t) => `mcp__veritas__${t.name}`).join(",");
  const kickoff = `It is ${nowIso()} (UTC). Scan the wire, pick ONE tradable story, and trade it.`;

  const args = [
    "-p",
    kickoff,
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--mcp-config",
    buildMcpConfig(),
    "--strict-mcp-config",
    "--tools",
    "",
    "--allowedTools",
    allowedTools,
    "--dangerously-skip-permissions",
    "--append-system-prompt",
    buildSystemPrompt(bankroll),
    "--model",
    model,
    "--max-budget-usd",
    budgetUsd,
    "--no-session-persistence",
  ];

  tapeLine(
    emit,
    "system",
    `RUN START — engine=claude-code model=${model} budget=$${budgetUsd} bankroll=$${bankroll.toFixed(2)}`
  );

  await new Promise<void>((resolve) => {
    // stdin "ignore" = the `< /dev/null` claude suggests for non-interactive
    // spawns; an open empty stdin pipe stalls startup for 3s.
    const child = spawn(claudeBin, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderrTail: string[] = [];
    let sawResult = false;
    let turn = 0;
    let killTimer: NodeJS.Timeout | null = null;

    const deadlineTimer = setTimeout(() => {
      tapeLine(emit, "system", `deadline ${Math.round(timeoutMs / 1000)}s reached — killing session`);
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
    }, timeoutMs);

    child.on("error", (err) => {
      const detail =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? `claude CLI not found (${claudeBin}) — set VERITAS_CLAUDE_BIN`
          : err.message;
      setStatus("anthropic", "down", detail, emit);
      emit({ type: "run_error", message: detail });
      clearTimeout(deadlineTimer);
      resolve();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail.push(chunk.toString());
      if (stderrTail.length > 20) stderrTail.shift();
    });

    const handleLine = (raw: string) => {
      if (!raw.trim()) return;
      let line: StreamLine;
      try {
        line = JSON.parse(raw) as StreamLine;
      } catch {
        return;
      }

      if (line.type === "system" && line.subtype === "init") {
        setStatus("anthropic", "live", `claude-code ${line.model ?? model}`, emit);
        const veritasTools = (line.tools ?? []).filter((t) => t.startsWith("mcp__veritas__"));
        const mcpStatus = (line.mcp_servers ?? [])
          .map((s) => `${s.name}=${s.status}`)
          .join(" ");
        tapeLine(
          emit,
          "system",
          `session ${line.session_id?.slice(0, 8) ?? "?"} — model=${line.model ?? model} mcp[${mcpStatus || "none"}] veritas-tools=${veritasTools.length}`
        );
        if (veritasTools.length === 0) {
          tapeLine(
            emit,
            "error",
            "no mcp__veritas__ tools loaded — the agent cannot trade this run"
          );
        }
        return;
      }

      if (line.type === "stream_event" && line.event && !line.parent_tool_use_id) {
        const event = line.event;
        if (event.type === "message_start") {
          turn += 1;
          return;
        }
        if (event.type === "content_block_delta" && event.delta) {
          const id = `m${turn}b${event.index ?? 0}`;
          if (event.delta.type === "thinking_delta" && event.delta.thinking) {
            emit({ type: "tape", id, ts: nowIso(), kind: "thinking", text: event.delta.thinking, delta: true });
          } else if (event.delta.type === "text_delta" && event.delta.text) {
            emit({ type: "tape", id, ts: nowIso(), kind: "say", text: event.delta.text, delta: true });
          }
        }
        return;
      }

      if (line.type === "result") {
        sawResult = true;
        if (line.is_error) {
          const detail = line.errors?.join("; ") || line.subtype || "unknown error";
          setStatus("anthropic", "down", detail, emit);
          emit({ type: "run_error", message: detail });
        } else {
          tapeLine(
            emit,
            "system",
            `session result — cost=$${line.total_cost_usd?.toFixed(2) ?? "?"} turns=${line.num_turns ?? "?"} api=${Math.round((line.duration_ms ?? 0) / 1000)}s`
          );
        }
      }
      // Full assistant/user messages and tool_use/tool_result echoes are
      // intentionally ignored: /api/tools/* already emitted richer lines.
    };

    createInterface({ input: child.stdout }).on("line", handleLine);

    child.on("close", (code) => {
      clearTimeout(deadlineTimer);
      if (killTimer) clearTimeout(killTimer);
      if (!sawResult && code !== 0) {
        const detail = `claude exited with code ${code}: ${stderrTail.join("").trim().slice(-400) || "no stderr"}`;
        setStatus("anthropic", "down", detail, emit);
        emit({ type: "run_error", message: detail });
      }
      resolve();
    });
  });

  emit({ type: "state", portfolio: snapshot() });
  tapeLine(
    emit,
    "system",
    `RUN COMPLETE — trades=${state.trades} denials=${state.denials} elapsed=${Math.round((Date.now() - startedAt) / 1000)}s`
  );
  emit({ type: "done" });
}
