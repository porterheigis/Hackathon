import { getPresetList } from "@/lib/scenario";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ presets: getPresetList() });
}
