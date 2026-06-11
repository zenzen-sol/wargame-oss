"use client";

// Mirrors apps/www/components/theme-toggle.tsx — same pill of three
// icon buttons (light / system / dark). Positioned centered along
// the bottom edge with a 1.5rem inset by default; pass `className`
// to override placement when reused elsewhere.

import { cn } from "@/lib/utils";
import { MonitorIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  const options = [
    { value: "light", icon: SunIcon },
    { value: "system", icon: MonitorIcon },
    { value: "dark", icon: MoonIcon },
  ] as const;

  return (
    <div
      className={cn(
        "fixed",
        "bottom-6",
        "left-1/2",
        "-translate-x-1/2",
        "z-50",
        "inline-flex",
        "items-center",
        "gap-1",
        "rounded-full",
        "border",
        "border-background/70",
        "bg-muted/40",
        "backdrop-blur-md",
        "p-1",
        "shadow-sm",
        "hover:bg-muted",
        "transition-colors",
        "duration-300",
        className,
      )}
    >
      {options.map(({ value, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => setTheme(value)}
          className={cn(
            "rounded-full p-1.5 transition-colors",
            theme === value
              ? "bg-background text-foreground shadow-sm"
              : "text-foreground/60 hover:text-foreground hover:bg-background",
          )}
          aria-label={`${value} theme`}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
