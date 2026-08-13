-- ============================================================================
-- 012 — SECURITY FIX: strip EXECUTE from PUBLIC.
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default, so an earlier
-- "REVOKE ... FROM anon, authenticated" was a no-op — the privilege came from
-- PUBLIC, not from those roles.
--
-- Before this fix, any signed-in user could:
--   * record_login_attempt(email, ip, true) -> clear their own failed-login
--     history, defeating login rate limiting entirely
--   * rpc_log(...)                          -> forge audit-trail entries
--   * next_doc_no(...)                      -> burn document-number sequences
--
-- Caught by scripts/security-test.sql, which now guards against regressions.
-- ============================================================================

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION
  current_app_user(), has_permission(text), is_signed_in(),
  is_locked(text, text, date),
  rpc_save_weighing(int,int,date,numeric,int),
  rpc_delete_weighing(bigint),
  rpc_move_crate(text,text,text,int,bigint,text[],text,bigint,text,text),
  rpc_open_pallet(text), rpc_add_crate_to_pallet(text,bigint),
  rpc_close_pallet(bigint,int), rpc_move_pallet(text,int),
  rpc_my_profile(), rpc_touch_login()
TO authenticated;
