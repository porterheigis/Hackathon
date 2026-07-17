import { getWorldModel } from "@/lib/adapters/nexla";
import { gateReadTool } from "@/lib/adapters/pomerium";

export const dynamic = "force-dynamic";

/** World model served via Nexla adapter (live MCP or local Nexset). */
export async function GET() {
  const gate = gateReadTool("get_world_model");
  if (!gate.allowed) {
    return Response.json(
      { error: "Pomerium denied get_world_model", decision: gate },
      { status: 403 }
    );
  }
  const model = await getWorldModel();
  return Response.json({
    ...model.data,
    _meta: {
      nexla: model.source,
      pomerium: gate.source,
      latencyMs: model.latencyMs,
    },
  });
}
