"use client";

import { PickRow } from "@/components/ui/pick-row";
import type { Tables } from "@/types/database.types";

type Party = Tables<"project_parties">;

export function PartyRow({
  party,
  index,
  picked,
  onToggle,
}: {
  party: Party;
  index: number;
  picked: boolean;
  onToggle: () => void;
}) {
  const role = (party.role ?? "").trim();
  const name = (party.name ?? "").trim();
  const label =
    name && role ? `${name} · ${role}` : name || role || `Party ${index + 1}`;
  return (
    <li>
      <PickRow kind="checkbox" checked={picked} onCheckedChange={onToggle}>
        {label}
      </PickRow>
    </li>
  );
}
