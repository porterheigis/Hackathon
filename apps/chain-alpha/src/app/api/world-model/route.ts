import { loadWorldModelById } from "@/lib/scenarios";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  // Accept ?worldModelId=semiconductors|red-sea (default semiconductors).
  // ?industry= is kept as an alias for the world-model id.
  const worldModelId =
    searchParams.get("worldModelId") ??
    searchParams.get("industry") ??
    "semiconductors";

  const model = loadWorldModelById(worldModelId);
  return Response.json(model);
}
