import { runScreen } from "@/lib/orchestrator";
import type { OrchestratorEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    text?: string;
    preset_id?: string;
    replay?: boolean;
  };

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
        await runScreen(send, {
          text: body.text,
          preset_id: body.preset_id,
          replay: body.replay,
        });
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

/** Also support GET for EventSource with query params */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const text = searchParams.get("text") ?? undefined;
  const preset_id = searchParams.get("preset_id") ?? undefined;
  const replay =
    searchParams.get("replay") === "1" || searchParams.get("replay") === "true";

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
        await runScreen(send, { text, preset_id, replay });
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
            /* */
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
