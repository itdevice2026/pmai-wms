import { dbHealthy } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Uptime probe. Returns 200 only when the database is reachable, so a
 * monitor catches a broken DATABASE_URL rather than reporting a green app
 * that cannot serve a single page.
 */
export async function GET() {
  const started = Date.now();
  const db = await dbHealthy();
  return Response.json(
    {
      status: db ? "ok" : "degraded",
      database: db ? "up" : "down",
      latencyMs: Date.now() - started,
      time: new Date().toISOString(),
    },
    { status: db ? 200 : 503, headers: { "cache-control": "no-store" } }
  );
}
