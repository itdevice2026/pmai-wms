import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The publishable key is intentionally public — it grants nothing on its own.
 * Authorisation lives in the database: RLS gates reads, and the `authenticated`
 * role has NO insert/update/delete on any table, so every write must go
 * through an rpc_* function that re-checks permission, the crate lifecycle and
 * period locks. See db/010-012 and scripts/security-test.sql.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const configured = Boolean(url && key);

let client: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  if (!configured) throw new Error("Supabase is not configured for this build.");
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return client;
}

export type RpcResult = {
  ok: boolean;
  message: string;
  crateNo?: string;
  sku?: string;
  weightKg?: number;
  [k: string]: unknown;
};

export async function rpc<T = RpcResult>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await sb().rpc(fn, args);
  if (error) {
    const denied = error.code === "42501" || /permission|not signed in/i.test(error.message);
    return {
      ok: false,
      message: denied ? "You don't have permission for that action." : error.message,
    } as T;
  }
  return data as T;
}
