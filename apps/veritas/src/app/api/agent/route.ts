import { runAgent } from "@/lib/agent/loop";
import { beginRun, endRun } from "@/lib/agent/run-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const encoder = new TextEncoder();
  let closed = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const run = beginRun((event) => {
    if (closed || !controllerRef) return;
    try {
      controllerRef.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      closed = true;
    }
  });
  if (!run) {
    return Response.json({ error: "a run is already in progress" }, { status: 409 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controllerRef = controller;
      try {
        await runAgent(run);
      } catch (err) {
        run.emit({
          type: "run_error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        endRun(run.id);
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
      endRun(run.id);
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
