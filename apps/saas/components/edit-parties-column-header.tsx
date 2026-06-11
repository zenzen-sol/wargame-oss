"use client";

export function EditPartiesColumnHeader() {
  return (
    <div className="flex flex-row items-center gap-3 px-3 pb-2 text-muted-foreground uppercase tracking-wider text-xs">
      <div className="w-50">Role</div>
      <div className="flex-1">Name</div>
      <div className="w-8" />
    </div>
  );
}
