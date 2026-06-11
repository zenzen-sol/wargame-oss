"use client";

// Sileo Toaster mount. Mirrors the augustus-omni setup so toasts
// land with consistent styling across our apps. Lives inside
// ThemeProvider so `useTheme()` resolves before this renders.

import { useTheme } from "next-themes";
import { Toaster } from "sileo";

export function ToasterProvider() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <Toaster
      position="bottom-right"
      theme={isDark ? "dark" : "light"}
      options={
        isDark
          ? {
              fill: "#1c1c1e",
              styles: {
                title: "!text-neutral-100",
                description: "!text-neutral-400",
              },
            }
          : undefined
      }
    />
  );
}
