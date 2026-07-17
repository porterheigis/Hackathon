import { loadWorldModel } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const model = loadWorldModel();
  return Response.json(model);
}
