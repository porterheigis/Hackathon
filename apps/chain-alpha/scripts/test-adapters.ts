/**
 * Offline smoke test for all four sponsor adapters + orchestrator deny/allow path.
 * Run: npm run test:adapters
 */

import { runSimulation, runScenarioSimulation } from "../src/lib/adapters/akash";
import { loadIndustry, loadScenario, loadWorldModelById } from "../src/lib/scenarios";
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
import { runLiveTransportTests } from "./test-live-transport";

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

  console.log("\n── ChainAlpha scenario engine ──");
  const industry = loadIndustry("semiconductors");
  const world = loadWorldModelById("semiconductors");
  const primary = loadScenario("taiwan-earthquake");

  const sim1 = runScenarioSimulation({
    scenario: primary,
    industry,
    worldModel: world,
  });
  const op1 = sim1.operational;
  const fin1 = sim1.financial;
  const intc1 = sim1.companies.find((c) => c.companyId === "INTC");
  console.log(
    `primary: supply −${op1.supplyReductionPercent}% · delay ${op1.deliveryDelayDays}d · invCover ${op1.inventoryCoverageDays}d · shortage p=${op1.shortageProbability} · recovery ${op1.recoveryMinDays}–${op1.recoveryMaxDays}d`
  );
  console.log(
    `primary: companies=${sim1.companies.length} · INTC=${intc1?.direction} · revAtRisk $${(fin1.revenueAtRiskMinUsd / 1e9).toFixed(2)}–$${(fin1.revenueAtRiskMaxUsd / 1e9).toFixed(2)}B · conf ${fin1.confidence}`
  );
  if (!(op1.supplyReductionPercent > 0)) throw new Error("supplyReductionPercent must be > 0");
  if (sim1.companies.length !== 6) throw new Error("expected 6 company impacts");
  if (intc1?.direction !== "positive") throw new Error("Intel must be positive (beneficiary) in the primary scenario");

  const secondary = loadScenario("japan-export-restriction");
  const sim2 = runScenarioSimulation({
    scenario: primary,
    industry,
    worldModel: world,
    secondary,
  });
  const op2 = sim2.operational;
  const fin2 = sim2.financial;
  const intc2 = sim2.companies.find((c) => c.companyId === "INTC");
  console.log(
    `+japan: supply −${op2.supplyReductionPercent}% · delay ${op2.deliveryDelayDays}d · invCover ${op2.inventoryCoverageDays}d · shortage p=${op2.shortageProbability} · recovery ${op2.recoveryMinDays}–${op2.recoveryMaxDays}d`
  );
  console.log(
    `+japan: INTC=${intc2?.direction} · revAtRisk $${(fin2.revenueAtRiskMinUsd / 1e9).toFixed(2)}–$${(fin2.revenueAtRiskMaxUsd / 1e9).toFixed(2)}B · conf ${fin2.confidence}`
  );
  if (!(op2.supplyReductionPercent > op1.supplyReductionPercent)) {
    throw new Error("secondary shock must worsen supplyReductionPercent");
  }
  if (!(op2.shortageProbability >= op1.shortageProbability)) {
    throw new Error("secondary shock must not reduce shortage probability");
  }
  if (!(fin2.revenueAtRiskMaxUsd > fin1.revenueAtRiskMaxUsd)) {
    throw new Error("secondary shock must worsen revenue at risk");
  }
  if (intc2?.direction === "positive") {
    throw new Error("Intel must flip away from positive under the Japan shock");
  }
  console.log(`ChainAlpha: Intel flipped ${intc1?.direction} → ${intc2?.direction}; impacts worsened deterministically`);

  // Live-transport data layer (observed vessels + aircraft).
  await runLiveTransportTests();

  console.log("\n✓ All adapter smoke tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
