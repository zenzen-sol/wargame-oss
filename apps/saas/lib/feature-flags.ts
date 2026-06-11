// Centralized feature-flag reads.
//
// Flags are env-driven and intentionally cheap to check. Each flag
// has both a server-only reader and a public reader; use the public
// reader from client components by surfacing
// `NEXT_PUBLIC_FEATURE_*` to the build.

const isTrue = (v: string | undefined): boolean =>
  v === "1" || v === "true";

/** Multi-file contracts: when off (default), projects accept at
 *  most one `.docx`. The run pipeline (chat route, drafter,
 *  redline/memo compile) is single-file by deep assumption. Flip on
 *  ONLY when the multi-file plumbing has been built out across
 *  the whole pipeline. */
export const featureMultiFileContracts = {
  serverEnabled(): boolean {
    return isTrue(process.env.FEATURE_MULTI_FILE_CONTRACTS);
  },
  publicEnabled(): boolean {
    return isTrue(process.env.NEXT_PUBLIC_FEATURE_MULTI_FILE_CONTRACTS);
  },
};
