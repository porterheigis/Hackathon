import { buildSimTimeline, sampleAssetPosition, formatSimClock, phaseAt } from "../src/lib/timeline";
import { runScreen, runSimulatePhase } from "../src/lib/orchestrator";
import type { FundState, OrchestratorEvent } from "../src/lib/types";
import { loadWorldModel } from "../src/lib/store";

function collect() {
  let last: FundState | null = null;
  const emit = (e: OrchestratorEvent) => {
    if (e.type === "state" || e.type === "done") last = e.payload as FundState;
    if (e.type === "error") throw new Error(String(e.payload));
  };
  return { emit, get: () => last! };
}

async function main() {
  const a = collect();
  await runScreen(a.emit, { preset_id: "hormuz-closure" });
  const screen = a.get();
  if (!screen.scenario) throw new Error("no scenario");
  console.log("screen OK", screen.affectedOutcomes.length, "outcomes");

  const b = collect();
  await runSimulatePhase(b.emit, {
    scenario_id: screen.scenario.scenario_id,
    outcomes: screen.affectedOutcomes.map((o) => o.id),
  });
  const sim = b.get();
  const tl = sim.sim?.timeline;
  if (!tl) throw new Error("missing timeline");
  console.log(
    "timeline OK",
    `duration=${tl.duration_ms}ms`,
    `phases=${tl.phases.length}`,
    `assets=${tl.assets.length}`,
    `events=${tl.events.length}`
  );
  if (tl.assets.length < 5) throw new Error("too few assets");
  if (!tl.phases.find((p) => p.id === "strike")) throw new Error("no strike");
  const mid = sampleAssetPosition(tl.assets[0], 0.5);
  console.log("sample asset", mid);
  console.log("clock", formatSimClock(3.5), "phase", phaseAt(tl, 0.5).id);

  // Air-heavy taiwan
  const c = collect();
  await runScreen(c.emit, { preset_id: "taiwan-blockade" });
  const s2 = c.get();
  const d = collect();
  await runSimulatePhase(d.emit, {
    scenario_id: s2.scenario!.scenario_id,
    outcomes: s2.affectedOutcomes.map((o) => o.id),
  });
  const tl2 = d.get().sim?.timeline;
  if (!tl2) throw new Error("taiwan missing timeline");
  const planes = tl2.assets.filter((a) => a.kind === "plane").length;
  const mil = tl2.assets.filter((a) => a.kind === "military").length;
  console.log("taiwan OK", `planes=${planes}`, `military=${mil}`, `assets=${tl2.assets.length}`);
  console.log("wm nodes", loadWorldModel().nodes.length);
  console.log("✓ timeline smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
