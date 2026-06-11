"use client";

import { cn } from "@/lib/utils";
import type { ComponentType, ReactNode } from "react";

export function PanelShell({
  icon: Icon,
  textTone,
  borderTone,
  title,
  subtitle,
  action,
  children,
  className,
}: {
  icon: ComponentType<{
    className?: string;
    weight?: "duotone";
    size?: number;
  }>;
  textTone?: string;
  borderTone?: string;
  title: string;
  subtitle?: string;
  /** Right-aligned slot in the header row (e.g. the Conference Room's
   *  Debate ↔ Draft toggle button). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex h-full min-h-0 flex-col gap-2", className)}>
      <div
        className={cn(
          "flex items-center gap-2 border-b-4 pb-2 border-border max-h-10",
          borderTone,
        )}
      >
        <Icon
          weight="duotone"
          size={28}
          className={cn(textTone ?? "text-foreground")}
        />
        <span className="font-semibold shrink-0">{title}</span>
        {subtitle && (
          <span
            className="min-w-0 flex-1 line-clamp-1 text-muted-foreground"
            title={subtitle}
          >
            {subtitle}
          </span>
        )}
        {action && (
          <div className="ml-auto grid place-content-center shrink-0">
            {action}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}
