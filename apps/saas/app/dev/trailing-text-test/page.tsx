"use client";

// Isolation test for the FilePhaseBody trailing-text rotation.
// Uses the `fade-through` spec from the animate-text catalog —
// Material-style content swap with soft blur, slight rise on
// entrance, and a gentle lift on exit.

import { Button } from "@/components/ui/button";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

const PHASES = [
  "Pick a provider to enable Start.",
  "Locking the file and starting the agents.",
  "Reading the contract. This takes a moment.",
  "",
] as const;

const ENTER_EASE = [0.2, 0, 0, 1] as const;
const EXIT_EASE = [0.4, 0, 1, 1] as const;

export default function TrailingTextTestPage() {
  const [i, setI] = useState(0);
  const trailingText = PHASES[i];
  return (
    <div className="mx-auto flex max-w-md flex-col gap-8 p-12">
      <div className="flex flex-col gap-2">
        <Button onClick={() => setI((p) => (p + 1) % PHASES.length)}>
          Next phase
        </Button>
        <div className="text-sm text-muted-foreground">
          phase #{i} · key=&quot;{trailingText || "(empty)"}&quot;
        </div>
      </div>

      <div className="relative min-h-6 text-center text-muted-foreground">
        <AnimatePresence mode="popLayout" initial={false}>
          {trailingText && (
            <motion.p
              key={trailingText}
              initial={{
                opacity: 0,
                y: 6,
                scale: 0.99,
                filter: "blur(2px)",
              }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
                filter: "blur(0px)",
                transition: { duration: 0.36, ease: ENTER_EASE },
              }}
              exit={{
                opacity: 0,
                y: -4,
                filter: "blur(0px)",
                transition: { duration: 0.26, ease: EXIT_EASE },
              }}
              className="absolute inset-x-0"
            >
              {trailingText}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
