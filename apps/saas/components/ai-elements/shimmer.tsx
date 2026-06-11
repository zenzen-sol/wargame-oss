"use client";

import { cn } from "@/lib/utils";
import type { CSSProperties, ElementType } from "react";
import { createElement, memo, useMemo } from "react";

export interface TextShimmerProps {
  children: string;
  as?: ElementType;
  className?: string;
  /** Cycle duration in seconds. Default 2s. */
  duration?: number;
  spread?: number;
  /** Resting text color. Any CSS color or var() expression.
   *  Defaults to the project's `--color-muted-foreground` token. */
  base?: string;
  /** Bright sweep color that passes across the text. Any CSS color
   *  or var() expression. Defaults to `--color-foreground` — pick a
   *  color that contrasts with `base` on the surface this sits on. */
  highlight?: string;
}

// Pure-CSS shimmer. We used to drive this with `motion.create("span")`
// from motion/react, but verified live (Shimmer test harness at
// /dev/shimmer-test, 2026-05-17) that motion.create was NEVER
// starting the animation — Element.getAnimations() returned [] on
// every instance, in every parent tree, including a bare element
// with no motion ancestor. The library quietly drops the keyframe
// start. A native `@keyframes` rule has no such failure mode and is
// driven by the compositor regardless of ancestor state, so the
// shimmer works the same in the reasoning columns, center column,
// and pending-row contexts.
//
// The gradient stack is unchanged: a moving (transparent → highlight
// → transparent) layer painted over a solid `base` layer, clipped
// to the text glyphs via `bg-clip-text` + `color: transparent`.
const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2,
  base = "var(--color-muted-foreground)",
  highlight = "var(--color-foreground)",
}: TextShimmerProps) => {
  const dynamicSpread = useMemo(
    () => (children?.length ?? 0) * spread,
    [children, spread],
  );

  const backgroundImage = useMemo(
    () =>
      [
        `linear-gradient(90deg, transparent calc(50% - var(--shimmer-spread)), ${highlight}, transparent calc(50% + var(--shimmer-spread)))`,
        `linear-gradient(${base}, ${base})`,
      ].join(", "),
    [base, highlight],
  );

  return createElement(
    Component,
    {
      className: cn(
        "ai-shimmer relative inline-block bg-size-[250%_100%,auto] bg-clip-text text-transparent",
        "[background-repeat:no-repeat,padding-box]",
        className,
      ),
      style: {
        "--shimmer-spread": `${dynamicSpread}px`,
        "--shimmer-duration": `${duration}s`,
        backgroundImage,
      } as CSSProperties,
    },
    children,
  );
};

export const Shimmer = memo(ShimmerComponent);
