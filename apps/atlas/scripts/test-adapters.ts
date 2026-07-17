/**
 * Offline smoke test for all four sponsor adapters + orchestrator deny/allow path.
 * Run: npm run test:adapters
 */

import { runSimulation } from "../src/lib/adapters/akash";
import {
  getWorldModel,
  mapEventToNodes,
  logSignal,
  recordFill,
  getPositions,
} from "../src/lib/adapters/nexla";
import { gateExecuteTrade, getRiskAuditLog, clearRiskAuditLog } from "../src/lib/adapters/pomerium";
import { ingestViaZero, executeViaZero, resetZeroWallet } from "../src/lib/adapters/zero";
import { loadFixtureEvent, resetPositionBook } from "../src/lib/store";

async function main() {
  resetPositionBook();
  resetZeroWallet(5);
  clearRiskAuditLog();

  console.log("── Nexla ──");
  const wm = await getWorldModel();
  console.log(`get_world_model: ${wm.data.nodes.length} nodes (${wm.source})`);
  if (wm.data.nodes.length < 30) throw new Error("world model too small");

  const event = loadFixtureEvent();
  const mapped = await mapEventToNodes({
    epicenter_node: event.epicenter_node,
    implied_probability: event.implied_probability,
  });
  console.log(`map_event_to_nodes: ${mapped.data.nodeIds.length} affected`);

  console.log("── Zero ──");
  const ingest = await ingestViaZero({ replay: true });
  console.log(
    `ingest: ${ingest.event.id} · caps=${ingest.capabilities.length} · spend=$${ingest.spendUsd}`
  );

  console.log("── Akash ──");
  const { result, lease } = await runSimulation(event);
  console.log(
    `sim: ${result.n_sims} runs · top=${result.markets[0]?.market_id} · lease=${lease.lease_id}`
  );

  const best = result.markets[0]!;
  await logSignal({
    market_id: best.market_id,
    side: best.side,
    ev: best.expected_value,
    confidence: best.confidence,
  });

  console.log("── Pomerium ──");
  const deny = await gateExecuteTrade({
    market_id: best.market_id,
    side: best.side,
    size_usd: 5,
    price: best.market_price ?? 0.5,
  });
  if (deny.decision.allowed) throw new Error("expected DENY for $5 stake");
  console.log(deny.decision.logLine);

  const allow = await gateExecuteTrade({
    market_id: best.market_id,
    side: best.side,
    size_usd: 1.5,
    price: best.market_price ?? 0.5,
  });
  if (!allow.decision.allowed) throw new Error("expected ALLOW for $1.50 stake");
  console.log(allow.decision.logLine);

  console.log("── Execute + Nexla fill ──");
  const fill = await executeViaZero({
    market_id: best.market_id,
    side: best.side,
    size_usd: 1.5,
    price: best.market_price ?? 0.5,
  });
  await recordFill({
    market_id: fill.market_id,
    side: fill.side,
    size_usd: fill.size_usd,
    price: fill.price,
    zero_tx: fill.tx,
  });
  const book = await getPositions();
  console.log(`position book entries: ${book.data.length}`);
  console.log(`pomerium audit: ${getRiskAuditLog().length} decisions`);

  console.log("\n✓ All adapter smoke tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
