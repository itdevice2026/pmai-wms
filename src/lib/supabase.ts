"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client.
 *
 * The publishable key is intentionally public — it grants nothing on its own.
 * All authorisation is enforced in the database: RLS gates reads, and the
 * `authenticated` role has no INSERT/UPDATE/DELETE on any table, so every
 * write must go through the `rpc_*` functions which re-check permissions,
 * the crate lifecycle and period locks. See db/010–012.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY at build time."
    );
  }
  if (!client) {
    client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

export function isConfigured(): boolean {
  return Boolean(url && key);
}

/** Shape returned by every rpc_* write function. */
export type RpcResult = {
  ok: boolean;
  message: string;
  crateNo?: string;
  sku?: string;
  weightKg?: number;
  toStatus?: string;
  [k: string]: unknown;
};

/**
 * Call a write RPC. Postgres raises 42501 for a missing permission, which
 * surfaces here as a readable message rather than a raw error code.
 */
export async function rpc<T = RpcResult>(
  fn: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) {
    const denied =
      error.code === "42501" || /permission|not signed in/i.test(error.message);
    return {
      ok: false,
      message: denied
        ? "You don't have permission for that action."
        : error.message,
    } as T;
  }
  return data as T;
}

/** Typed SELECT helper that throws on error so callers can use try/catch. */
export async function select<T>(
  table: string,
  build: (q: ReturnType<SupabaseClient["from"]>) => unknown
): Promise<T[]> {
  const query = build(supabase().from(table)) as unknown as Promise<{
    data: T[] | null;
    error: { message: string } | null;
  }>;
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}
