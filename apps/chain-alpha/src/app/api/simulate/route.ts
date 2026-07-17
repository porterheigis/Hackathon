import { z } from "zod";

import { runPipeline } from "@/lib/orchestrator";
import { parseScenario } from "@/lib/parser";
import { loadScenario } from "@/lib/scenarios";
import { getTransportSnapshot } from "@/lib/live-transport/service";
import type { LiveTransportSnapshot, OrchestratorEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const QuerySchema = z.object({
  replay: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
  scenarioId: z.string().min(1).max(64).optional(),
  industry: z.string().min(1).max(64).optional(),
  company: z.string().min(1).max(32).optional(),
  horizonDays: z.coerce.number().int().min(1).max(720).optional(),
  prompt: z.string().max(2000).optional(),
  secondaryShockId: z.string().min(1).max(64).optional(),
  region: z.string().min(1).max(32).optional(),
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const parsedQuery = QuerySchema.safeParse({
    replay: searchParams.get("replay") ?? undefined,
    scenarioId: searchParams.get("scenarioId") ?? undefined,
    industry: searchParams.get("industry") ?? undefined,
    company: searchParams.get("company") ?? undefined,
    horizonDays: searchParams.get("horizonDays") ?? undefined,
    prompt: searchParams.get("prompt") ?? undefined,
    secondaryShockId: searchParams.get("secondaryShockId") ?? undefined,
    region: searchParams.get("region") ?? undefined,
  });

  if (!parsedQuery.success) {
    return Response.json(
      { error: "invalid_query", issues: parsedQuery.error.issues },
      { status: 400 }
    );
  }

  const q = parsedQuery.data;
  const replay = Boolean(q.replay);

  // Build the scenario deterministically (curated selection, or free-text parse).
  const parsed = parseScenario({
    prompt: q.prompt,
    scenarioId: q.scenarioId,
    industry: q.industry,
    company: q.company,
    horizonDays: q.horizonDays,
  });

  const secondaryShock = q.secondaryShockId
    ? loadScenario(q.secondaryShockId)
    : undefined;

  // Resolve the observation region: explicit param wins, else infer from the world model.
  const regionId =
    q.region ??
    (parsed.scenario.worldModelId === "red-sea" ? "red-sea" : "taiwan");
  const liveEnabled = process.env.LIVE_TRANSPORT_ENABLED === "true";
  const transportReplay = replay || !liveEnabled;

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: OrchestratorEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        // Capture the live-transport baseline server-side (never throws — falls back to
        // replay internally). Optional/additive: on failure the pipeline runs as before.
        let transportBaseline: LiveTransportSnapshot | undefined;
        try {
          transportBaseline = await getTransportSnapshot(regionId, {
            replay: transportReplay,
          });
        } catch {
          transportBaseline = undefined;
        }

        await runPipeline(send, {
          replay,
          scenario: parsed.scenario,
          secondaryShock,
          parseConfidence: parsed.confidence,
          parseSource: parsed.source,
          transportBaseline,
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
