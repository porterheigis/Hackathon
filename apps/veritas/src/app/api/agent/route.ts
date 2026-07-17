import { runAgent } from "@/lib/agent/loop";
import type { AgentEvent } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let activeRun = false;

export async function GET() {
  if (activeRun) {
    return Response.json({ error: "a run is already in progress" }, { status: 409 });
  }
  activeRun = true;

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        await runAgent(send);
      } catch (err) {
        send({
          type: "run_error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        activeRun = false;
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
      activeRun = false;
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
