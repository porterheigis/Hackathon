import { getRiskAuditLog } from "@/lib/adapters/pomerium";
import { getDiscoveredCapabilities, getZeroWallet } from "@/lib/adapters/zero";
import { getAkashLeaseInfo } from "@/lib/adapters/akash";
import { getPositionBook } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    wallet: getZeroWallet(),
    capabilities: getDiscoveredCapabilities(),
    positions: getPositionBook(),
    pomerium: getRiskAuditLog(),
    akash: getAkashLeaseInfo(),
  });
}
