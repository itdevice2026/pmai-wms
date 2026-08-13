-- ============================================================================
-- 010 — Supabase Auth + RLS, for the browser-only (GitHub Pages) deployment.
--
-- ARCHITECTURE NOTE
-- In this deployment there is no application server: the browser talks to
-- PostgREST directly with the publishable key. That means the database is the
-- ONLY place security and business rules can live.
--
-- So:
--   * Every table gets RLS. Reads are permission-gated.
--   * The `authenticated` role gets NO direct INSERT/UPDATE/DELETE on any
--     operational table. Writes happen exclusively through SECURITY DEFINER
--     functions below, which re-check permissions, the crate lifecycle and
--     period locks server-side.
--   * A user therefore cannot bypass a rule by crafting their own REST call,
--     which is the failure mode that makes naive client-only apps unsafe.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Link app users to Supabase Auth identities
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE;
CREATE INDEX IF NOT EXISTS users_auth_idx ON users(auth_user_id);

-- password_hash is meaningless once GoTrue owns credentials.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

/** The signed-in app user, or NULL. STABLE so PostgREST caches it per request. */
CREATE OR REPLACE FUNCTION current_app_user()
RETURNS users LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT u.* FROM users u
   WHERE u.auth_user_id = auth.uid() AND u.is_active
   LIMIT 1;
$$;

/** True when the signed-in user holds `p_code`. Admins hold everything. */
CREATE OR REPLACE FUNCTION has_permission(p_code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
      FROM users u
      JOIN roles r ON r.id = u.role_id
     WHERE u.auth_user_id = auth.uid()
       AND u.is_active
       AND (
         r.code = 'admin'
         OR EXISTS (
           SELECT 1 FROM role_permissions rp
             JOIN permissions p ON p.id = rp.permission_id
            WHERE rp.role_id = r.id AND p.code = p_code)
       )
  );
$$;

/** Convenience: signed in at all. */
CREATE OR REPLACE FUNCTION is_signed_in()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE auth_user_id = auth.uid() AND is_active);
$$;

GRANT EXECUTE ON FUNCTION current_app_user(), has_permission(text), is_signed_in()
  TO authenticated;

-- ---------------------------------------------------------------------------
-- READ POLICIES
--
-- Reference data is readable by any signed-in user — the UI needs SKU lists,
-- locations and so on to render at all. Operational and sensitive tables are
-- gated on the matching view permission.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  ref_tables text[] := ARRAY[
    'plants','roles','permissions','role_permissions','product_categories',
    'product_classes','products','size_classes','crate_types','locations',
    'storage_rooms','storage_aisles','stations','growers','customers',
    'app_settings','doc_sequences'];
BEGIN
  -- Clear any previous generated policies so this migration is re-runnable.
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies
            WHERE schemaname = 'public' AND policyname LIKE 'wms_%'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;

  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
    -- FORCE would also apply to the table owner, which breaks the
    -- SECURITY DEFINER functions below. Owner bypass is what we want here.
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', r.tablename);

    IF r.tablename = ANY(ref_tables) THEN
      EXECUTE format(
        'CREATE POLICY wms_read_ref ON public.%I FOR SELECT TO authenticated USING (is_signed_in())',
        r.tablename);
    END IF;
  END LOOP;
END $$;

-- Operational tables: gated on the relevant view permission.
CREATE POLICY wms_read_crates ON crates FOR SELECT TO authenticated
  USING (has_permission('report.view') OR has_permission('bd.weighing.view')
         OR has_permission('wh.receiving.view'));
CREATE POLICY wms_read_weighing ON weighing_records FOR SELECT TO authenticated
  USING (has_permission('bd.weighing.view') OR has_permission('report.view'));
CREATE POLICY wms_read_pallets ON pallets FOR SELECT TO authenticated
  USING (is_signed_in());
CREATE POLICY wms_read_movements ON crate_movements FOR SELECT TO authenticated
  USING (has_permission('report.view') OR has_permission('qa.crate_audit.view'));
CREATE POLICY wms_read_lbr ON live_bird_receipts FOR SELECT TO authenticated
  USING (has_permission('bd.live_bird.view'));
CREATE POLICY wms_read_byp ON byproduct_entries FOR SELECT TO authenticated
  USING (has_permission('bd.byproducts.view'));
CREATE POLICY wms_read_fps ON fps_processings FOR SELECT TO authenticated
  USING (has_permission('fps.entry.view') OR has_permission('report.view'));
CREATE POLICY wms_read_fps_in ON fps_inputs FOR SELECT TO authenticated
  USING (has_permission('fps.entry.view') OR has_permission('report.view'));
CREATE POLICY wms_read_fps_out ON fps_outputs FOR SELECT TO authenticated
  USING (has_permission('fps.entry.view') OR has_permission('report.view'));
CREATE POLICY wms_read_jo ON job_orders FOR SELECT TO authenticated
  USING (is_signed_in());
CREATE POLICY wms_read_bjo ON blanket_job_orders FOR SELECT TO authenticated
  USING (has_permission('plan.bjo.view'));
CREATE POLICY wms_read_pd ON pallet_dispositions FOR SELECT TO authenticated
  USING (has_permission('plan.disposition.view'));
CREATE POLICY wms_read_transfers ON transfers FOR SELECT TO authenticated
  USING (has_permission('wh.transfer.view'));
CREATE POLICY wms_read_transfer_lines ON transfer_lines FOR SELECT TO authenticated
  USING (has_permission('wh.transfer.view'));
CREATE POLICY wms_read_iss ON issuances FOR SELECT TO authenticated
  USING (has_permission('wh.issuance.view'));
CREATE POLICY wms_read_iss_lines ON issuance_lines FOR SELECT TO authenticated
  USING (has_permission('wh.issuance.view'));
CREATE POLICY wms_read_pick ON picklists FOR SELECT TO authenticated
  USING (has_permission('wh.picklist.view'));
CREATE POLICY wms_read_pick_lines ON picklist_lines FOR SELECT TO authenticated
  USING (has_permission('wh.picklist.view'));
CREATE POLICY wms_read_picks ON picklist_picks FOR SELECT TO authenticated
  USING (has_permission('wh.picklist.view'));
CREATE POLICY wms_read_disp ON dispatches FOR SELECT TO authenticated
  USING (has_permission('wh.dispatch.view'));
CREATE POLICY wms_read_disp_lines ON dispatch_lines FOR SELECT TO authenticated
  USING (has_permission('wh.dispatch.view'));
CREATE POLICY wms_read_adj ON stock_adjustments FOR SELECT TO authenticated
  USING (has_permission('wh.adjustment.manage') OR has_permission('report.view'));
CREATE POLICY wms_read_adj_lines ON stock_adjustment_lines FOR SELECT TO authenticated
  USING (has_permission('wh.adjustment.manage') OR has_permission('report.view'));
CREATE POLICY wms_read_temp ON temperature_logs FOR SELECT TO authenticated
  USING (has_permission('qa.temperature.view'));
CREATE POLICY wms_read_cut_runs ON cutting_runs FOR SELECT TO authenticated
  USING (is_signed_in());
CREATE POLICY wms_read_cut_in ON cutting_inputs FOR SELECT TO authenticated
  USING (is_signed_in());
CREATE POLICY wms_read_cut_out ON cutting_outputs FOR SELECT TO authenticated
  USING (is_signed_in());
CREATE POLICY wms_read_imports ON import_batches FOR SELECT TO authenticated
  USING (has_permission('bd.import.use'));
CREATE POLICY wms_read_locks ON locked_records FOR SELECT TO authenticated
  USING (is_signed_in());

-- Sensitive: a user may always see their own row; the full list needs the
-- user-admin permission. Password hashes are no longer used but stay hidden.
CREATE POLICY wms_read_users ON users FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR has_permission('sys.users.view'));

CREATE POLICY wms_read_activity ON activity_logs FOR SELECT TO authenticated
  USING (has_permission('sys.activity.view'));

-- Login attempts are never client-readable: the counts would tell an attacker
-- exactly how much budget they have left.
REVOKE ALL ON login_attempts FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- WRITES: denied directly. Everything goes through the RPCs in 011.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated',
      r.tablename);
  END LOOP;
END $$;

-- Views inherit the RLS of their base tables because they are defined with
-- security_invoker below, so a user only ever sees rows their policies allow.
ALTER VIEW v_stock_on_hand           SET (security_invoker = true);
ALTER VIEW v_stock_on_hand_by_date   SET (security_invoker = true);
ALTER VIEW v_stock_on_hand_by_pallet SET (security_invoker = true);
ALTER VIEW v_stock_ageing            SET (security_invoker = true);
ALTER VIEW v_storage_map             SET (security_invoker = true);
ALTER VIEW v_production_summary      SET (security_invoker = true);
ALTER VIEW v_unscanned_crates        SET (security_invoker = true);

GRANT SELECT ON v_stock_on_hand, v_stock_on_hand_by_date, v_stock_on_hand_by_pallet,
                v_stock_ageing, v_storage_map, v_production_summary, v_unscanned_crates
  TO authenticated;

-- anon sees nothing at all.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
