"use client";

import { ChromeMenu } from "@/components/shell/chrome-menu";
import { ScrollAwareChrome } from "@/components/shell/scroll-aware-chrome";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";

/**
 * The single source of top chrome for every authed page. Drops the
 * old layout-level header and the per-page header in favor of one
 * scroll-aware bar that knows where the user is (breadcrumbs, left)
 * and what they can do (overflow menu, right).
 *
 * Page contributions:
 *   - `breadcrumbs` — required. Last item renders as the current
 *     page (no link). "Wargame" / brand is rendered automatically as
 *     the first segment when `includeBrand !== false`.
 *   - `actions` — optional. Page-specific menu items injected at
 *     the top of the dropdown, above the global utility actions
 *     (Settings · Theme · Sign out).
 *
 * Why a menu rather than flat buttons (Hick's Law): every secondary
 * action (rename/archive/settings/sign out/theme) was previously
 * shouting at users across two stacked headers. Collapsing them
 * into one menu cuts perceived choice count to two: "where am I"
 * (breadcrumb) and "what else can I do" (menu). Jakob's Law: this
 * is the pattern users already know from every other web app.
 */
export interface AppChromeProps {
  breadcrumbs: BreadcrumbSpec[];
  actions?: ReactNode;
  /** Defaults to true — first segment is "Wargame" linking to "/". */
  includeBrand?: boolean;
}

export interface BreadcrumbSpec {
  /** Plain text label. Used for non-link and link segments. */
  label: ReactNode | string;
  /** If set, the segment renders as a link. */
  href?: string;
  /**
   * Optional custom node for the rendered segment. When provided,
   * the breadcrumb renders this instead of `label` (e.g. a click-to-
   * edit title input). Only honoured on the LAST segment.
   */
  node?: ReactNode;
}

export function AppChrome({
  breadcrumbs,
  actions,
  includeBrand = true,
}: AppChromeProps) {
  const segments: BreadcrumbSpec[] = includeBrand
    ? [{ label: "Wargame", href: "/" }, ...breadcrumbs]
    : breadcrumbs;

  return (
    <ScrollAwareChrome>
      <div className="flex items-end justify-between gap-4 px-6 py-3 lg:px-8">
        <Breadcrumb>
          <BreadcrumbList>
            {segments.map((seg, i) => {
              const isLast = i === segments.length - 1;
              return (
                <Fragment key={`${seg.label}-${i}`}>
                  <BreadcrumbItem>
                    {isLast && seg.node ? (
                      seg.node
                    ) : isLast || !seg.href ? (
                      <BreadcrumbPage className="max-w-[40ch] truncate">
                        {seg.label}
                      </BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink
                        render={<Link href={seg.href}>{seg.label}</Link>}
                      />
                    )}
                  </BreadcrumbItem>
                  {!isLast && <BreadcrumbSeparator />}
                </Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
        <ChromeMenu>{actions}</ChromeMenu>
      </div>
    </ScrollAwareChrome>
  );
}
