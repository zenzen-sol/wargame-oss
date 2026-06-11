import { Shimmer } from "@/components/ai-elements/shimmer";

// Shared route-segment fallback. Renders a near-blank screen with a
// shimmer "Loading" label positioned to match the AppChrome
// breadcrumbs (px-6 py-3 lg:px-8). Used by /(auth)/loading.tsx and
// /(welcome)/welcome/loading.tsx so that the brief moment between a
// post-login redirect and the next render isn't a flash of nothing.
//
// Intentional choices: no spinner, no ellipsis, no other chrome.
// The single shimmer in the breadcrumb slot reads as "we know where
// you are, we're just finishing up" rather than as a generic spinner.
export function RouteLoading() {
  return (
    <div className="flex min-h-svh flex-col">
      <div className="flex items-end gap-4 px-6 py-3 lg:px-8">
        <Shimmer as="span" className="text-base">
          Loading
        </Shimmer>
      </div>
    </div>
  );
}
