/**
 * GET /api/live-transport/status?region=taiwan
 *
 * Cheap provider-status probe → { maritime, aviation, region }. Reuses the cached snapshot's
 * provider statuses so a status poll does not reconnect to AISStream / re-fetch ADSB.lol.
 */

import { z } from "zod";

import { getTransportSnapshot } from "@/lib/live-transport/service";
import { resolveRegion } from "@/lib/live-transport/regions";

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

  const region = resolveRegion(parsed.data.region);
  const liveEnabled = process.env.LIVE_TRANSPORT_ENABLED === "true";
  const replay = Boolean(parsed.data.replay) || !liveEnabled;

  try {
    const snapshot = await getTransportSnapshot(region.id, { replay });
    return Response.json(
      {
        region: { id: region.id, label: region.label },
        maritime: snapshot.providers.maritime,
        aviation: snapshot.providers.aviation,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return Response.json(
      { error: "status_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
