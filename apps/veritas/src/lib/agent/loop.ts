/**
 * The agent loop — a manual streaming tool-use loop over the Claude API.
 * Thinking deltas and text deltas are forwarded to the tape in real time;
 * every tool result (including risk-gate DENYs, as is_error) goes back to
 * the model, which decides the next move itself.
 */
import Anthropic from "@anthropic-ai/sdk";
import { setStatus } from "../cache";
import { snapshot } from "../portfolio";
import type { Emit, TapeKind } from "../sse";
import { nowIso, uid } from "../sse";
import { buildSystemPrompt } from "./system-prompt";
import { executeTool, TOOL_DEFS, type RunState } from "./tools";

const MAX_TURNS = 12;
const MAX_RUN_MS = 150_000;

const EFFORTS = ["low", "medium", "high"] as const;
type Effort = (typeof EFFORTS)[number];

function effortFromEnv(): Effort {
  const raw = process.env.VERITAS_EFFORT ?? "medium";
  return (EFFORTS as readonly string[]).includes(raw) ? (raw as Effort) : "medium";
}

function tapeLine(
  emit: Emit,
  kind: TapeKind,
  text: string,
  extra?: { tool?: string; payload?: unknown }
): void {
  emit({ type: "tape", id: uid("line"), ts: nowIso(), kind, text, ...extra });
}

export async function runAgent(emit: Emit): Promise<void> {
  const client = new Anthropic();
  const model = process.env.VERITAS_MODEL ?? "claude-opus-4-8";
  const effort = effortFromEnv();
  const bankroll = snapshot().walletUsd;
  const run: RunState = { trades: 0, denials: 0 };
  const startedAt = Date.now();

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `It is ${nowIso()} (UTC). Scan the wire, pick ONE tradable story, and trade it.`,
    },
  ];

  tapeLine(emit, "system", `RUN START — model=${model} effort=${effort} bankroll=$${bankroll.toFixed(2)}`);

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = client.messages.stream({
        model,
        max_tokens: 8000,
        system: buildSystemPrompt(bankroll),
        tools: TOOL_DEFS,
        messages,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort },
      });

      for await (const event of stream) {
        if (event.type !== "content_block_delta") continue;
        const id = `t${turn}b${event.index}`;
        if (event.delta.type === "thinking_delta") {
          emit({
            type: "tape",
            id,
            ts: nowIso(),
            kind: "thinking",
            text: event.delta.thinking,
            delta: true,
          });
        } else if (event.delta.type === "text_delta") {
          emit({
            type: "tape",
            id,
            ts: nowIso(),
            kind: "say",
            text: event.delta.text,
            delta: true,
          });
        }
      }

      const message = await stream.finalMessage();
      setStatus("anthropic", "live", model, emit);
      messages.push({ role: "assistant", content: message.content });

      if (message.stop_reason !== "tool_use") break;

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of message.content) {
        if (block.type !== "tool_use") continue;
        tapeLine(emit, "tool_call", JSON.stringify(block.input), {
          tool: block.name,
          payload: block.input,
        });
        const outcome = await executeTool(block.name, block.input, { emit, run });
        const kind: TapeKind = outcome.deny ? "deny" : outcome.ok ? "tool_result" : "error";
        tapeLine(emit, kind, JSON.stringify(outcome.result), {
          tool: block.name,
          payload: outcome.result,
        });
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(outcome.result),
          ...(outcome.ok ? {} : { is_error: true }),
        });
      }
      messages.push({ role: "user", content: results });

      if (Date.now() - startedAt > MAX_RUN_MS) {
        tapeLine(emit, "system", "wall-clock cap reached — ending run");
        break;
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    setStatus("anthropic", "down", detail, emit);
    emit({ type: "run_error", message: detail });
  }

  emit({ type: "state", portfolio: snapshot() });
  tapeLine(
    emit,
    "system",
    `RUN COMPLETE — trades=${run.trades} denials=${run.denials} elapsed=${Math.round((Date.now() - startedAt) / 1000)}s`
  );
  emit({ type: "done" });
}
