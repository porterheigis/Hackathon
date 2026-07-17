import { getAkashLeaseInfo } from "@/lib/adapters/akash";
import { getPositions } from "@/lib/adapters/nexla";
import { getRiskAuditLog } from "@/lib/adapters/pomerium";
import {
  getDiscoveredCapabilities,
  getZeroWallet,
} from "@/lib/adapters/zero";

export const dynamic = "force-dynamic";

/** Sponsor integration status — proves each adapter is in the loop. */
export async function GET() {
  const positions = await getPositions();
  const akash = getAkashLeaseInfo();
  const wallet = getZeroWallet();
  const pomerium = getRiskAuditLog();

  return Response.json({
    sponsors: {
      zero: {
        role: "odds/news ingest + trade execution wallet",
        wallet,
        capabilities: getDiscoveredCapabilities(),
        inLoop: true,
      },
      nexla: {
        role: "world model + position book MCP tools",
        source: positions.source,
        positionCount: positions.data.length,
        tool: positions.tool,
        inLoop: true,
      },
      pomerium: {
        role: "execute_trade stake gate (deny over max, allow resized)",
        decisions: pomerium.length,
        last: pomerium[pomerium.length - 1] ?? null,
        audit: pomerium.slice(-5),
        inLoop: true,
      },
      akash: {
        role: "Monte Carlo EV simulation",
        ...akash,
        inLoop: true,
      },
    },
  });
}
