"use client";

import { AnthropicLogo } from "@/components/brand/anthropic";
import { OpenAILogo } from "@/components/brand/openai";
import { StatusPill } from "@/components/projects/status-pill";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProjectSummary } from "@/lib/queries/projects";
import { cn } from "@/lib/utils";
import { CaretDownIcon, CaretUpIcon, DotsSixIcon } from "@phosphor-icons/react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type ColumnMeta = {
  width?: string;
  align?: "left" | "right";
  // Tailwind classes for sticky positioning at lg+. Provide the
  // exact left offset (e.g. "lg:left-[72px]") since the table is
  // not column-grid based. Cells render with `lg:bg-background`
  // (or header bg) so content can scroll underneath them.
  sticky?: string;
  // Right-edge shadow on the last sticky column to visually
  // separate the pinned block from the scrolling area.
  stickyEdge?: boolean;
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function partyLabel(p: { name: string; role: string | null }): string {
  const name = p.name.trim();
  const role = (p.role ?? "").trim();
  return name || role || "—";
}

function PartiesCell({
  parties,
}: {
  parties: { name: string; role: string | null }[];
}) {
  if (parties.length === 0)
    return <span className="text-muted-foreground/50">—</span>;
  const [first, ...rest] = parties;
  if (!first) return <span className="text-muted-foreground/50">—</span>;
  return (
    <span
      className="inline-flex items-baseline gap-1.5 text-sm"
      title={parties.map(partyLabel).join("\n")}
    >
      <span className="truncate">{partyLabel(first)}</span>
      {rest.length > 0 && (
        <span className="text-xs text-muted-foreground">+{rest.length}</span>
      )}
    </span>
  );
}

function ProviderCell({ provider }: { provider: string | null }) {
  if (provider === "anthropic") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm">
        <AnthropicLogo size={14} className="text-foreground/80" />
        <span>Anthropic</span>
      </span>
    );
  }
  if (provider === "openai") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm">
        <OpenAILogo size={14} className="text-foreground/80" />
        <span>OpenAI</span>
      </span>
    );
  }
  // Legacy / pre-BYOK rows that never had a snapshot. Keep the
  // column readable rather than rendering a broken-looking blank.
  return <span className="text-muted-foreground/50">—</span>;
}

function FilesCell({ files }: { files: { name: string }[] }) {
  if (files.length === 0)
    return <span className="text-muted-foreground/50">—</span>;
  const [first, ...rest] = files;
  if (!first) return <span className="text-muted-foreground/50">—</span>;
  return (
    <span
      className="inline-flex items-baseline gap-1.5 text-sm"
      title={files.map((f) => f.name).join("\n")}
    >
      <span className="truncate">{first.name}</span>
      {rest.length > 0 && (
        <span className="text-xs text-muted-foreground">+{rest.length}</span>
      )}
    </span>
  );
}

export function ProjectTable({ projects }: { projects: ProjectSummary[] }) {
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>([
    { id: "created", desc: true },
  ]);

  const columns = useMemo<ColumnDef<ProjectSummary>[]>(
    () => [
      {
        id: "displayId",
        accessorFn: (p) => p.display_id ?? "",
        header: "ID",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.display_id ?? "—"}
          </span>
        ),
        meta: {
          // Lock to exactly 72px so NAME's sticky `lg:left-[72px]`
          // sits flush against ID's right edge. With table-auto +
          // `w-[72px]` alone, the column would compress to its
          // (narrower) content width and leave a gap where the
          // scrolling columns underneath could bleed through.
          width: "w-[72px] min-w-[72px] max-w-[72px]",
          sticky: "lg:left-0",
        } satisfies ColumnMeta,
      },
      {
        id: "name",
        accessorFn: (p) => p.name ?? "",
        header: "Name",
        cell: ({ row }) => (
          <span className="font-medium font-display italic text-foreground truncate">
            {row.original.name?.trim() || "Untitled project"}
          </span>
        ),
        meta: {
          // Lock NAME at exactly 320px so its sticky position is
          // predictable across rows; otherwise content-driven width
          // jitter leaves a gap between ID and NAME.
          width: "w-[320px] min-w-[320px] max-w-[320px]",
          sticky: "lg:left-[72px]",
          stickyEdge: true,
        } satisfies ColumnMeta,
      },
      {
        id: "status",
        accessorFn: (p) => p.status,
        header: "Status",
        cell: ({ row }) => <StatusPill status={row.original.status} />,
        meta: { width: "min-w-[160px]" } satisfies ColumnMeta,
      },
      {
        id: "provider",
        accessorFn: (p) => p.provider ?? "",
        header: "Provider",
        cell: ({ row }) => <ProviderCell provider={row.original.provider} />,
        meta: { width: "min-w-[140px]" } satisfies ColumnMeta,
      },
      {
        id: "userParties",
        accessorFn: (p) =>
          p.project_parties.find((x) => x.is_user_side === true)?.name ?? "",
        header: "Your side",
        cell: ({ row }) => (
          <PartiesCell
            parties={row.original.project_parties.filter(
              (p) => p.is_user_side === true,
            )}
          />
        ),
        meta: { width: "min-w-[180px] max-w-[240px]" } satisfies ColumnMeta,
      },
      {
        id: "counterparties",
        accessorFn: (p) =>
          p.project_parties.find((x) => x.is_user_side === false)?.name ?? "",
        header: "Counterparty",
        cell: ({ row }) => (
          <PartiesCell
            parties={row.original.project_parties.filter(
              (p) => p.is_user_side === false,
            )}
          />
        ),
        meta: { width: "min-w-[180px] max-w-[240px]" } satisfies ColumnMeta,
      },
      {
        id: "files",
        accessorFn: (p) => p.files[0]?.name ?? "",
        header: "Source files",
        cell: ({ row }) => <FilesCell files={row.original.files} />,
        meta: { width: "min-w-[220px] max-w-[360px]" } satisfies ColumnMeta,
      },
      {
        id: "maxIssues",
        header: "Max. Issues",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground tabular-nums">
            {row.original.max_issues}
          </span>
        ),
        meta: {
          width: "min-w-[120px]",
          align: "right",
        } satisfies ColumnMeta,
      },
      {
        id: "maxTurns",
        header: "Max. Turns",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground tabular-nums">
            {row.original.max_turns_per_issue}
          </span>
        ),
        meta: {
          width: "min-w-[120px]",
          align: "right",
        } satisfies ColumnMeta,
      },
      {
        id: "updated",
        accessorFn: (p) => p.updated_at,
        header: "Updated",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground tabular-nums">
            {formatDateTime(row.original.updated_at)}
          </span>
        ),
        meta: {
          width: "min-w-[200px]",
          align: "right",
        } satisfies ColumnMeta,
      },
      {
        id: "created",
        accessorFn: (p) => p.created_at,
        header: "Created",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground tabular-nums">
            {formatDateTime(row.original.created_at)}
          </span>
        ),
        meta: {
          width: "min-w-[200px]",
          align: "right",
        } satisfies ColumnMeta,
      },
    ],
    [],
  );

  const table = useReactTable({
    data: projects,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="rounded-lg border border-border overflow-y-scroll">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow
              key={hg.id}
              className="hover:bg-transparent bg-foreground/5"
            >
              {hg.headers.map((h) => {
                const meta = h.column.columnDef.meta as ColumnMeta | undefined;
                const canSort = h.column.getCanSort();
                const sorted = h.column.getIsSorted();
                return (
                  <TableHead
                    key={h.id}
                    className={cn(
                      meta?.width,
                      meta?.align === "right" && "text-right",
                      // Sticky header cells need an OPAQUE background:
                      // the row carries `bg-foreground/5` translucently,
                      // so a translucent sticky cell would let non-sticky
                      // header text scroll visibly through it. Pre-mix the
                      // tint with the solid background so the result is
                      // opaque but visually identical to the row tint.
                      meta?.sticky &&
                        cn(
                          "lg:sticky lg:z-20",
                          "lg:bg-[color-mix(in_oklab,var(--foreground)_5%,var(--background))]",
                          meta.sticky,
                        ),
                      meta?.stickyEdge &&
                        "lg:shadow-[inset_-1px_0_0_var(--color-border),8px_0_8px_-4px_color-mix(in_oklab,var(--foreground)_10%,transparent)]",
                    )}
                  >
                    {h.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={h.column.getToggleSortingHandler()}
                        className={cn(
                          "group inline-flex items-center gap-1 uppercase tracking-wider transition-colors cursor-pointer",
                          "outline-none focus-visible:text-accent hover:text-foreground",
                          meta?.align === "right" && "w-full justify-end",
                        )}
                      >
                        {meta?.align === "right" && (
                          <SortIndicator sorted={sorted} />
                        )}
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {meta?.align !== "right" && (
                          <SortIndicator sorted={sorted} />
                        )}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => {
            const slug = row.original.slug;
            const href = slug
              ? `/projects/${slug}`
              : `/projects/${row.original.id}`;
            return (
              <TableRow
                key={row.id}
                className="group cursor-pointer"
                onClick={() => router.push(href)}
              >
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta as
                    | ColumnMeta
                    | undefined;
                  return (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        meta?.width,
                        meta?.align === "right" && "text-right",
                        // Sticky body cells need opaque backgrounds in
                        // BOTH the rest and hover states. `pick-hover`
                        // is translucent; we have an opaque pre-mixed
                        // variant `--pick-hover-opaque` for exactly
                        // this case.
                        meta?.sticky &&
                          cn(
                            "lg:sticky lg:z-10 lg:bg-background transition-colors",
                            "lg:group-hover:bg-[var(--pick-hover-opaque)]",
                            meta.sticky,
                          ),
                        // 1px inset hairline on the right plus a wider
                        // outset drop-shadow that fades content as it
                        // scrolls under the sticky column — gives the
                        // pinned edge a clear visual presence.
                        meta?.stickyEdge &&
                          "lg:shadow-[inset_-1px_0_0_var(--color-border),8px_0_8px_-4px_color-mix(in_oklab,var(--foreground)_10%,transparent)]",
                      )}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function SortIndicator({ sorted }: { sorted: false | "asc" | "desc" }) {
  if (sorted === "asc") return <CaretUpIcon size={14} />;
  if (sorted === "desc") return <CaretDownIcon size={14} />;
  return (
    <span className="text-foreground/30 transition-colors group-hover:text-foreground">
      <DotsSixIcon size={14} weight="bold" />
    </span>
  );
}
