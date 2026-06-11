"use client";

import { useCallback } from "react";

export function EditableTitle({
  value,
  editing,
  onStartEdit,
  onCancel,
  onCommit,
}: {
  value: string;
  editing: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onCommit: (next: string) => void;
}) {
  const focusAndSelectEnd = useCallback((el: HTMLInputElement | null) => {
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  const titleType =
    "block bg-transparent p-0 text-left text-base leading-6 tracking-tight font-bold min-w-[24ch] w-auto";

  if (editing) {
    return (
      <input
        ref={focusAndSelectEnd}
        defaultValue={value}
        aria-label="Project name"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={(e) => onCommit(e.currentTarget.value)}
        className={`${titleType} border-0 outline-none ring-0 focus-visible:text-accent`}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={onStartEdit}
      aria-label="Rename project"
      className={`${titleType} cursor-text hover:text-foreground/80 outline-none focus-visible:text-accent`}
    >
      {value}
    </button>
  );
}
