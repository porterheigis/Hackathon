import { getStatuses } from "@/lib/cache";
import { snapshot } from "@/lib/portfolio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json({ portfolio: snapshot(), statuses: getStatuses() });
}
