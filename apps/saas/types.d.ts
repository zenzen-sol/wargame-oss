// Subpath imports from @hugeicons/core-free-icons don't ship type
// declarations. lib/icon-map.tsx references many such subpaths. We
// don't actually consume the icon map ourselves — it came in with
// the fluidfunctionalism component installs — so a wildcard module
// declaration is sufficient to keep tsc happy.
declare module "@hugeicons/core-free-icons/*";
