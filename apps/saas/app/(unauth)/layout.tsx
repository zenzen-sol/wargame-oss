import { getSessionUser } from "@/lib/auth-session";
import { redirect } from "next/navigation";
import type { PropsWithChildren } from "react";

export default async function UnauthedLayout({ children }: PropsWithChildren) {
  const user = await getSessionUser();
  if (user) redirect("/");
  return <>{children}</>;
}
