import "server-only";
import { Pool } from "pg";

let pool: Pool | undefined;

export function getBetterAuthPool(): Pool {
  if (pool) return pool;
  const url = process.env.BETTER_AUTH_DATABASE_URL;
  if (!url) {
    throw new Error(
      "BETTER_AUTH_DATABASE_URL is not set. Use the Supabase Direct " +
        "connection or Session pooler URL — Better-Auth needs CREATE/ALTER " +
        "(only on first run / migrations) and persistent connections.",
    );
  }
  pool = new Pool({ connectionString: url });
  return pool;
}

export async function getDisclaimerAcknowledgedAt(
  userId: string,
): Promise<string | null> {
  const result = await getBetterAuthPool().query<{
    disclaimer_acknowledged_at: string | null;
  }>('select disclaimer_acknowledged_at from public."user" where id = $1', [
    userId,
  ]);
  return result.rows[0]?.disclaimer_acknowledged_at ?? null;
}

export async function acknowledgeDisclaimer(userId: string): Promise<void> {
  const result = await getBetterAuthPool().query(
    'update public."user" set disclaimer_acknowledged_at = coalesce(disclaimer_acknowledged_at, now()), "updatedAt" = now() where id = $1',
    [userId],
  );
  if (result.rowCount !== 1) {
    throw new Error("Could not acknowledge disclaimer for current user.");
  }
}
