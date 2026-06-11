"use client";

import type { ReactNode } from "react";

export function Section({
  title,
  description,
  hint,
  children,
}: {
  title: string;
  description?: ReactNode;
  hint?: string | null;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h2 className="font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="text-muted-foreground leading-snug text-pretty">
            {description}
          </p>
        )}
      </header>
      {children}
      {hint && (
        <p className="text-muted-foreground text-pretty" aria-live="polite">
          {hint}
        </p>
      )}
    </section>
  );
}
