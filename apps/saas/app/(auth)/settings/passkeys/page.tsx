import { PasskeysView } from "@/components/passkeys-view";
import { AppChrome } from "@/components/shell/app-chrome";
import { requireUser } from "@/lib/auth-session";
import { Pool } from "pg";

let pool: Pool | undefined;
function getPool(): Pool {
  if (pool) return pool;
  pool = new Pool({ connectionString: process.env.BETTER_AUTH_DATABASE_URL });
  return pool;
}

export default async function PasskeysPage() {
  const user = await requireUser();
  // Better-Auth's passkey table doesn't go through PostgREST/RLS —
  // we read it directly via the same Postgres pool Better-Auth uses.
  const result = await getPool().query<{
    id: string;
    name: string | null;
    deviceType: string;
    backedUp: boolean;
    createdAt: string;
  }>(
    'select id, name, "deviceType", "backedUp", "createdAt" from passkey where "userId" = $1 order by "createdAt" desc',
    [user.id],
  );

  return (
    <>
      <AppChrome breadcrumbs={[{ label: "Passkeys" }]} />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 overflow-y-auto px-6 py-8 lg:px-8">
        <PasskeysView passkeys={result.rows} />
      </main>
    </>
  );
}
