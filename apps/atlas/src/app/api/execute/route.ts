import { runExecutePhase } from "@/lib/orchestrator";
import type { OrchestratorEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    scenario_id?: string;
    proposal_ids?: string[];
  };

  if (!body.scenario_id || !body.proposal_ids?.length) {
    return Response.json(
      { error: "scenario_id and proposal_ids required" },
      { status: 400 }
    );
  }

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
        await runExecutePhase(send, {
          scenario_id: body.scenario_id!,
          proposal_ids: body.proposal_ids!,
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

/** GET for EventSource clients */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const scenario_id = searchParams.get("scenario_id") ?? "";
  const proposal_ids = (searchParams.get("proposal_ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!scenario_id || !proposal_ids.length) {
    return Response.json(
      { error: "scenario_id and proposal_ids required" },
      { status: 400 }
    );
  }

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
        await runExecutePhase(send, { scenario_id, proposal_ids });
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
