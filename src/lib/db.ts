import { Pool, type QueryResultRow } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __wmsPool: Pool | undefined;
}

const connectionString =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/wms";

const isSupabase = connectionString.includes("supabase.co");
const isPooled = connectionString.includes("pooler.supabase.com") ||
  connectionString.includes(":6543");

/**
 * On a serverless host every request may run in its own instance, so a large
 * per-instance pool multiplies into hundreds of Postgres connections and
 * exhausts the database. Keep it to one connection each and let Supabase's
 * Supavisor pooler do the multiplexing.
 *
 * On a long-lived server (Docker / VPS) a normal pool is correct.
 */
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

function makePool() {
  return new Pool({
    connectionString,
    max: isServerless ? 1 : 10,
    idleTimeoutMillis: isServerless ? 10_000 : 30_000,
    connectionTimeoutMillis: 10_000,
    // Supabase terminates TLS with its own CA; verifying it here adds no
    // security over the already-encrypted managed link and breaks on some hosts.
    ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
  });
}

export const pool = global.__wmsPool ?? makePool();
if (process.env.NODE_ENV !== "production") global.__wmsPool = pool;

// A pool error (e.g. the database restarting) must not take the process down.
pool.on("error", (err) => {
  console.error("[db] idle client error:", err.message);
});

if (isServerless && isSupabase && !isPooled) {
  console.warn(
    "[db] DATABASE_URL points at a direct Supabase connection on a serverless host. " +
      "Use the Session/Transaction pooler URI (port 6543) or you will exhaust connections."
  );
}

/** Run a query and return all rows. */
export async function q<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await pool.query<T>(text, params as never[]);
  return res.rows;
}

/** Run a query and return the first row (or null). */
export async function q1<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

/** Run a set of statements inside a transaction. */
export async function tx<T>(fn: (c: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already gone; nothing to roll back */
    }
    throw e;
  } finally {
    client.release();
  }
}

/** Next document number, e.g. nextDocNo('GRN') -> 'GRN-202608-00001' */
export async function nextDocNo(prefix: string): Promise<string> {
  const row = await q1<{ next_doc_no: string }>("SELECT next_doc_no($1) AS next_doc_no", [prefix]);
  return row!.next_doc_no;
}

/** Lightweight connectivity probe for /healthz. */
export async function dbHealthy(): Promise<boolean> {
  try {
    await q("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
