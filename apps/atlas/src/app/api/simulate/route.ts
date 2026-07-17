import { runPipeline, runSimulatePhase } from "@/lib/orchestrator";
import type { OrchestratorEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const replay =
    searchParams.get("replay") === "1" ||
    searchParams.get("replay") === "true";
  const scenario_id = searchParams.get("scenario_id");
  const outcomesParam = searchParams.get("outcomes") ?? "";
  const outcomes = outcomesParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: OrchestratorEvent) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      try {
        if (scenario_id) {
          await runSimulatePhase(send, {
            scenario_id,
            outcomes,
            replay,
          });
        } else {
          // Legacy / demo: full auto pipeline
          await runPipeline(send, { replay });
        }
      } catch (err) {
        send({
          type: "error",
          payload: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
