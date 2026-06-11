"use client";

// Reproduction harness for the StreamingBadge shimmer that froze
// only in the reasoning columns. The production <Shimmer> has been
// rewritten to use CSS keyframes, but to actually prove which tree
// configuration broke the original `motion.create("span")` version,
// we render that ORIGINAL implementation (inlined as MotionShimmer
// below) in cells matching production parent trees. View this in a
// FOREGROUND tab (hidden tabs throttle all animations to 0) and
// note which cells animate vs. freeze.

import {
  Conversation,
  ConversationContent,
} from "@/components/ai-elements/conversation";
import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties, ElementType, JSX } from "react";
import { memo, useMemo } from "react";

// ---------------------------------------------------------------------------
// MotionShimmer — verbatim copy of the previous production Shimmer
// before the CSS rewrite. Same imports, same `motion.create("span")`
// cache, same animate/initial/transition props. If this version
// freezes anywhere on a foreground tab, that IS the bug.
// ---------------------------------------------------------------------------
type MotionHTMLProps = Record<string, unknown>;
const motionCache = new Map<
  keyof JSX.IntrinsicElements,
  React.ComponentType<MotionHTMLProps>
>();
function getMotionComponent(element: keyof JSX.IntrinsicElements) {
  let c = motionCache.get(element);
  if (!c) {
    c = motion.create(element) as React.ComponentType<MotionHTMLProps>;
    motionCache.set(element, c);
  }
  return c;
}

interface ShimmerProps {
  children: string;
  as?: ElementType;
  base?: string;
  highlight?: string;
}
const MotionShimmer = memo(function MotionShimmer({
  children,
  as: Component = "span",
  base = "var(--color-muted-foreground)",
  highlight = "var(--color-foreground)",
}: ShimmerProps) {
  const MC = getMotionComponent(Component as keyof JSX.IntrinsicElements);
  const dynamicSpread = useMemo(() => (children?.length ?? 0) * 2, [children]);
  const backgroundImage = useMemo(
    () =>
      [
        `linear-gradient(90deg, transparent calc(50% - var(--spread)), ${highlight}, transparent calc(50% + var(--spread)))`,
        `linear-gradient(${base}, ${base})`,
      ].join(", "),
    [base, highlight],
  );
  return (
    <MC
      animate={{ backgroundPosition: "0% center" }}
      initial={{ backgroundPosition: "100% center" }}
      transition={{ duration: 2, ease: "linear", repeat: Number.POSITIVE_INFINITY }}
      className="motion-shimmer relative inline-block bg-size-[250%_100%,auto] bg-clip-text text-transparent [background-repeat:no-repeat,padding-box]"
      style={
        { "--spread": `${dynamicSpread}px`, backgroundImage } as CSSProperties
      }
    >
      {children}
    </MC>
  );
});

// ---------------------------------------------------------------------------
// Visual: the badge wrapper StreamingBadge uses in production.
// ---------------------------------------------------------------------------
function Badge() {
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <MotionShimmer as="span">Streaming</MotionShimmer> · 0:26
    </span>
  );
}

function Cell({
  n,
  label,
  children,
}: {
  n: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <div className="text-xs font-mono text-muted-foreground">
        #{n} · {label}
      </div>
      <div className="bg-background p-3 min-h-[3rem]">{children}</div>
    </div>
  );
}

export default function ShimmerReproPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-12">
      <h1 className="font-semibold">Motion-Shimmer reproduction harness</h1>
      <p className="text-sm text-muted-foreground">
        Each cell renders the previous motion-based Shimmer under a different
        ancestor tree. View in a foreground tab. Report which cells animate
        and which freeze.
      </p>

      <Cell n={1} label="Bare — no motion ancestor (mirrors ConversationItem center column)">
        <Badge />
      </Cell>

      <Cell n={2} label="Inside motion.div with translateY entrance (original reasoning-panel row)">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <Badge />
        </motion.div>
      </Cell>

      <Cell n={3} label="Inside motion.div with opacity-only entrance (current reasoning-panel row)">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <Badge />
        </motion.div>
      </Cell>

      <Cell n={4} label="Inside AnimatePresence(initial=false) + motion.div">
        <AnimatePresence initial={false}>
          <motion.div
            key="row"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <Badge />
          </motion.div>
        </AnimatePresence>
      </Cell>

      <Cell n={5} label="Inside Conversation > ConversationContent (StickToBottom only)">
        <div className="h-24 border border-dashed">
          <Conversation className="h-full">
            <ConversationContent className="gap-3 p-6 text-muted-foreground">
              <Badge />
            </ConversationContent>
          </Conversation>
        </div>
      </Cell>

      <Cell n={6} label="Full production stack: StickToBottom > AnimatePresence > motion.div (translateY)">
        <div className="h-24 border border-dashed">
          <Conversation className="h-full">
            <ConversationContent className="gap-3 p-6 text-muted-foreground">
              <AnimatePresence initial={false}>
                <motion.div
                  key="row"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  <Badge />
                </motion.div>
              </AnimatePresence>
            </ConversationContent>
          </Conversation>
        </div>
      </Cell>

      <Cell n={7} label="Full production stack with opacity-only entrance (post-fix shape)">
        <div className="h-24 border border-dashed">
          <Conversation className="h-full">
            <ConversationContent className="gap-3 p-6 text-muted-foreground">
              <AnimatePresence initial={false}>
                <motion.div
                  key="row"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  <Badge />
                </motion.div>
              </AnimatePresence>
            </ConversationContent>
          </Conversation>
        </div>
      </Cell>
    </div>
  );
}
