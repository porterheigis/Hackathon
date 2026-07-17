"use client";

import type { FundState } from "@/lib/types";

interface PartnerDockProps {
  telemetry: FundState["telemetry"];
  onOpen: () => void;
}

const PARTNERS = [
  { id: "zero", label: "Zero" },
  { id: "nexla", label: "Nexla" },
  { id: "akash", label: "Akash" },
  { id: "pomerium", label: "Pomerium" },
] as const;

function PartnerMark({ id }: { id: (typeof PARTNERS)[number]["id"] }) {
  if (id === "zero") return <span className="partner-mark zero-mark"><i /></span>;
  if (id === "nexla") return <span className="partner-mark nexla-mark"><i /><i /></span>;
  if (id === "akash") return <span className="partner-mark akash-mark"><i /><i /></span>;
  return <span className="partner-mark pomerium-mark"><i>◆</i></span>;
}

export function PartnerDock({ telemetry, onOpen }: PartnerDockProps) {
  const status: Record<(typeof PARTNERS)[number]["id"], string> = {
    zero: `$${telemetry.zeroSpendUsd.toFixed(2)}`,
    nexla: `${telemetry.nexlaToolCalls} calls`,
    akash: telemetry.akashLeaseId === "—" ? "standby" : "leased",
    pomerium: `${telemetry.pomeriumAllow}A / ${telemetry.pomeriumDeny}D`,
  };

  return (
    <div className="partner-dock" aria-label="System partners">
      {PARTNERS.map((partner) => (
        <button key={partner.id} type="button" className="partner-tile hud-panel" onClick={onOpen}>
          <PartnerMark id={partner.id} />
          <span>{partner.label}</span>
          <small>{status[partner.id]}</small>
        </button>
      ))}
    </div>
  );
}
