"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { FundState } from "@/lib/types";
import type { DrawerTab, Phase } from "@/lib/presentation";
import { AgentTape } from "@/components/AgentTape";
import { FundPanel } from "@/components/FundPanel";
import { OutcomePicker } from "@/components/OutcomePicker";
import { ProposalPanel } from "@/components/ProposalPanel";

interface CommandDrawerProps {
  open: boolean;
  activeTab: DrawerTab;
  state: FundState;
  phase: Phase;
  selectedOutcomes: string[];
  selectedProposals: string[];
  onTabChange: (tab: DrawerTab) => void;
  onClose: () => void;
  onOutcomeChange: (ids: string[]) => void;
  onProposalChange: (ids: string[]) => void;
  onRun: () => void;
  onExecute: () => void;
  onNewScenario: () => void;
}

const TABS: Array<{ id: DrawerTab; label: string }> = [
  { id: "activity", label: "Activity" },
  { id: "fund", label: "Fund" },
  { id: "outcomes", label: "Outcomes" },
  { id: "proposals", label: "Trades" },
  { id: "systems", label: "Systems" },
];

function SystemsPanel({ state }: { state: FundState }) {
  const { telemetry } = state;
  return (
    <div className="systems-panel">
      <p className="drawer-section-label">Execution fabric</p>
      <dl>
        <div><dt>Zero wallet</dt><dd>${telemetry.zeroWalletUsd.toFixed(2)}</dd></div>
        <div><dt>Zero spend</dt><dd>${telemetry.zeroSpendUsd.toFixed(2)}</dd></div>
        <div><dt>Nexla tool calls</dt><dd>{telemetry.nexlaToolCalls}</dd></div>
        <div><dt>Pomerium decisions</dt><dd>{telemetry.pomeriumAllow} allow / {telemetry.pomeriumDeny} deny</dd></div>
        <div><dt>Akash lease</dt><dd>{telemetry.akashLeaseId}</dd></div>
        <div><dt>Provider</dt><dd>{telemetry.akashProvider}</dd></div>
        <div><dt>Endpoint</dt><dd>{telemetry.akashEndpoint}</dd></div>
      </dl>
      {telemetry.capabilitiesDiscovered.length > 0 && (
        <div className="capability-list">
          <p className="drawer-section-label">Capabilities discovered</p>
          {telemetry.capabilitiesDiscovered.map((capability) => (
            <span key={capability}>{capability}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function CommandDrawer({
  open,
  activeTab,
  state,
  phase,
  selectedOutcomes,
  selectedProposals,
  onTabChange,
  onClose,
  onOutcomeChange,
  onProposalChange,
  onRun,
  onExecute,
  onNewScenario,
}: CommandDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            className="drawer-backdrop"
            aria-label="Close command details"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.aside
            className="command-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Command details"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 36 }}
          >
            <header className="drawer-header">
              <div>
                <p className="hud-kicker">Command details</p>
                <h2>{state.event?.title ?? "Atlas operating console"}</h2>
              </div>
              <button ref={closeRef} type="button" className="drawer-close" onClick={onClose}>
                <span aria-hidden="true">×</span>
                <span className="sr-only">Close</span>
              </button>
            </header>
            <div className="drawer-tabs" role="tablist" aria-label="Command detail sections">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={activeTab === tab.id ? "is-active" : ""}
                  onClick={() => onTabChange(tab.id)}
                >
                  {tab.label}
                  {tab.id === "outcomes" && state.affectedOutcomes.length > 0 && (
                    <span>{selectedOutcomes.length}</span>
                  )}
                  {tab.id === "proposals" && state.proposals.length > 0 && (
                    <span>{selectedProposals.length}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="drawer-body">
              {activeTab === "activity" && (
                <AgentTape tape={state.tape} idle={phase === "idle"} />
              )}
              {activeTab === "fund" && (
                <FundPanel
                  state={state}
                  showNewScenario={phase === "done" || phase === "awaiting_approval"}
                  onNewScenario={onNewScenario}
                />
              )}
              {activeTab === "outcomes" && (
                state.affectedOutcomes.length > 0 ? (
                  <OutcomePicker
                    outcomes={state.affectedOutcomes}
                    selected={selectedOutcomes}
                    onChange={onOutcomeChange}
                    onRun={onRun}
                    loading={phase === "simulating" || phase === "playing"}
                  />
                ) : (
                  <div className="drawer-empty">Analyze an event to reveal affected outcomes.</div>
                )
              )}
              {activeTab === "proposals" && (
                state.proposals.length > 0 ? (
                  <ProposalPanel
                    proposals={state.proposals}
                    selected={selectedProposals}
                    onChange={onProposalChange}
                    onExecute={onExecute}
                    loading={phase === "executing"}
                    denial={state.lastDenial}
                  />
                ) : (
                  <div className="drawer-empty">Run a simulation to generate trade proposals.</div>
                )
              )}
              {activeTab === "systems" && <SystemsPanel state={state} />}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
