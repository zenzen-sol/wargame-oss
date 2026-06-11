"use client";

import { cn } from "@/lib/utils";
import { type ReactNode, useCallback, useSyncExternalStore } from "react";

interface ScrollAwareChromeProps {
  /** Optional ref to the scrolling container. Falls back to window. */
  scrollTargetRef?: React.RefObject<HTMLElement | null>;
  /** Optional extra classes for the outer header element. */
  className?: string;
  children: ReactNode;
}

/**
 * Sticky top chrome that fades in a hairline border + blurred backdrop
 * once the underlying scroll container moves past the top. Children own
 * their own inner layout (max-width, padding, content clusters).
 *
 * Implementation: `useSyncExternalStore` is the React 19 idiom for
 * mirroring an external mutable value (the scroll position) into
 * render — strictly better than `useEffect` here because it removes
 * a tearing window between mount and the first listener firing, and
 * keeps us aligned with the brain rule that bans `useEffect` outside
 * a tiny set of legitimate cases.
 *
 * Ported from augustus-omni; the Tauri drag-region attribute from
 * the original is dropped (web app, no native window controls).
 */
export function ScrollAwareChrome({
  scrollTargetRef,
  className,
  children,
}: ScrollAwareChromeProps) {
  const subscribe = useCallback(
    (notify: () => void) => {
      const target: Window | HTMLElement = scrollTargetRef?.current ?? window;
      target.addEventListener("scroll", notify, { passive: true });
      return () => target.removeEventListener("scroll", notify);
    },
    [scrollTargetRef],
  );
  const getSnapshot = useCallback((): boolean => {
    const el = scrollTargetRef?.current ?? null;
    const top = el ? el.scrollTop : window.scrollY;
    return top > 4;
  }, [scrollTargetRef]);
  // Server snapshot is always "not scrolled" — there's no scroll
  // position during SSR, and the chrome's resting state is the
  // unblurred one anyway, so hydration mismatches are impossible.
  const scrolled = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => false,
  );

  return (
    <header
      className={cn(
        "sticky top-0 z-20 w-full",
        "transition-[background-color,border-color,backdrop-filter] duration-200 ease-out",
        scrolled
          ? "bg-background/80 backdrop-blur-md border-b border-border/60"
          : "bg-transparent border-b border-transparent",
        className,
      )}
    >
      {children}
    </header>
  );
}
