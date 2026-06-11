"use client";

import { Button } from "@/components/ui/button";
import { StopIcon } from "@phosphor-icons/react";

export function StopButton({ onStop }: { onStop: () => void }) {
  return (
    <Button type="button" onClick={onStop} variant="destructive">
      <StopIcon className="size-4" weight="duotone" />
    </Button>
  );
}
