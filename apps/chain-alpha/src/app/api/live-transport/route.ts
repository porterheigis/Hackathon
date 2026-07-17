/**
 * GET /api/live-transport?region=taiwan&replay=0|1
 *
 * The browser talks ONLY to this route (never to AISStream/ADSB.lol directly), so the
 * AISSTREAM_API_KEY stays server-side. Returns a LiveTransportSnapshot. Replay is forced
 * when replay=1 or when LIVE_TRANSPORT_ENABLED is not "true".
 */

import { z } from "zod";

import { getTransportSnapshot } from "@/lib/live-transport/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const QuerySchema = z.object({
  region: z.string().min(1).max(32).optional(),
  replay: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    region: searchParams.get("region") ?? undefined,
    replay: searchParams.get("replay") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_query", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const liveEnabled = process.env.LIVE_TRANSPORT_ENABLED === "true";
  // Force replay when requested OR when the live layer is disabled globally.
  const replay = Boolean(parsed.data.replay) || !liveEnabled;

  try {
    const snapshot = await getTransportSnapshot(parsed.data.region, { replay });
    return Response.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return Response.json(
      { error: "snapshot_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
