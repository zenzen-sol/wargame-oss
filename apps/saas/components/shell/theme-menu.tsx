"use client";

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { MonitorIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useTheme } from "next-themes";

export function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  // Before next-themes hydrates, `theme` is undefined; fall through
  // to "system" so the radio group has a stable value. The brief
  // flip after hydration (when the user's actual preference resolves)
  // is barely perceptible inside a closed submenu and not worth a
  // mounted-flag dance.
  const value = theme ?? "system";

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {value === "light" && <SunIcon size={20} />}
        {value === "dark" && <MoonIcon size={20} />}
        {value === "system" && <MonitorIcon size={20} />}
        <span>Theme</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-36">
        <DropdownMenuRadioGroup value={value} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <SunIcon size={20} />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <MoonIcon size={20} />
            Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <MonitorIcon size={20} />
            System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
