// Dev-only drafter sandbox page. 404s in production. See
// `components/dev/drafter-test-view.tsx` for the actual UI.

import { DrafterTestView } from "@/components/dev/drafter-test-view";
import { notFound } from "next/navigation";

export default async function DrafterTestPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DrafterTestView />;
}
