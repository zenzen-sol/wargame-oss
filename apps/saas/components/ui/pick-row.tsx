"use client";

// Canonical "pickable row" — a label-wrapped row containing a
// sr-only native input and a visible indicator (square for
// checkbox, circle for radio). Matches the design system's
// four-state grammar: rest / hover / selected /
// focused. Border-transparent at rest so the focus-visible
// border swap doesn't shift layout.

import { cn } from "@/lib/utils";
import { CheckIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

type PickRowBase = {
  children: ReactNode;
  className?: string;
};

type CheckboxProps = PickRowBase & {
  kind: "checkbox";
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
};

type RadioProps = PickRowBase & {
  kind: "radio";
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
};

export type PickRowProps = CheckboxProps | RadioProps;

const rowClass = cn(
  "flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer transition-colors",
  "border border-transparent outline-none",
  "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 focus-within:bg-pick-hover",
);

const stateClass = (checked: boolean) =>
  checked ? "bg-pick-selected" : "hover:bg-pick-hover bg-foreground/5";

export function PickRow(props: PickRowProps) {
  if (props.kind === "checkbox") {
    const { checked, onCheckedChange, children, className } = props;
    return (
      <label className={cn(rowClass, stateClass(checked), className)}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          className="sr-only"
        />
        <CheckboxIndicator checked={checked} />
        <span className="font-medium">{children}</span>
      </label>
    );
  }
  const { name, value, checked, onSelect, children, className } = props;
  return (
    <label className={cn(rowClass, stateClass(checked), className)}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onSelect()}
        className="sr-only"
      />
      <RadioIndicator checked={checked} />
      <span className="font-medium">{children}</span>
    </label>
  );
}

function CheckboxIndicator({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors bg-background",
        checked ? "border-transparent bg-foreground" : "border-border",
      )}
    >
      {checked && (
        <CheckIcon size={12} weight="bold" className="text-background" />
      )}
    </span>
  );
}

function RadioIndicator({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors bg-background",
        checked ? "border-foreground" : "border-border",
      )}
    >
      {checked && <span className="h-2 w-2 rounded-full bg-foreground" />}
    </span>
  );
}
