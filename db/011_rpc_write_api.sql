-- ============================================================================
-- 011 — The write API.
--
-- The browser has no INSERT/UPDATE/DELETE rights on any table (see 010).
-- These SECURITY DEFINER functions are the only way data changes, and each
-- one re-checks permission, the crate lifecycle and period locks itself.
-- A user cannot skip a rule by crafting their own REST call.
--
-- Every function returns jsonb of the shape {ok, message, ...} so the client
-- can render a result without a second round-trip.
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_require(p_permission text)
RETURNS users LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users;
BEGIN
  SELECT * INTO u FROM current_app_user();
  IF u.id IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(p_permission) THEN
    RAISE EXCEPTION 'Missing permission: %', p_permission USING ERRCODE = '42501';
  END IF;
  RETURN u;
END $$;

-- ---------------------------------------------------------------------------
-- Activity logging (used by every RPC)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rpc_log(
  p_user uuid, p_module text, p_action text,
  p_entity text DEFAULT NULL, p_entity_id text DEFAULT NULL, p_desc text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  INSERT INTO activity_logs (user_id, module, action, entity, entity_id, description)
  VALUES (p_user, p_module, p_action, p_entity, p_entity_id, p_desc);
$$;

-- ---------------------------------------------------------------------------
-- BD WEIGHING
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rpc_save_weighing(
  p_product_id int,
  p_crate_type_id int,
  p_production_date date,
  p_weight_kg numeric,
  p_heads int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  u users;
  v_tare numeric; v_type_name text;
  v_shelf int; v_sku text;
  v_plant plants;
  v_future int; v_ops_edit boolean;
  v_seq bigint; v_no text; v_net numeric;
  v_crate_id bigint;
BEGIN
  u := rpc_require('bd.weighing.manage');

  IF p_weight_kg IS NULL OR p_weight_kg <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Weight must be greater than zero.');
  END IF;
  IF p_heads IS NULL OR p_heads < 0 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Heads must be zero or more.');
  END IF;

  SELECT COALESCE((value #>> '{}')::int, 1) INTO v_future
    FROM app_settings WHERE scope='global' AND key='weighing.future_days';
  SELECT COALESCE((value #>> '{}')::boolean, false) INTO v_ops_edit
    FROM app_settings WHERE scope='global' AND key='weighing.operators_can_edit_date';

  IF p_production_date > current_date + COALESCE(v_future,1) THEN
    RETURN jsonb_build_object('ok', false, 'message',
      format('Production date can only be set up to %s day(s) ahead.', COALESCE(v_future,1)));
  END IF;

  IF p_production_date < current_date
     AND NOT COALESCE(v_ops_edit,false)
     AND NOT has_permission('bd.weighing.unlock_date') THEN
    RETURN jsonb_build_object('ok', false, 'message',
      'Back-dating is locked for operators. Ask a supervisor to unlock.');
  END IF;

  IF is_locked('weighing_records', NULL, p_production_date) THEN
    RETURN jsonb_build_object('ok', false, 'message',
      format('Production date %s is locked.', p_production_date));
  END IF;

  SELECT tare_kg, name INTO v_tare, v_type_name
    FROM crate_types WHERE id = p_crate_type_id AND is_active;
  IF v_tare IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Unknown crate type.');
  END IF;

  SELECT shelf_life_days, sku INTO v_shelf, v_sku
    FROM products WHERE id = p_product_id AND is_active;
  IF v_sku IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Unknown SKU.');
  END IF;

  v_net := p_weight_kg - v_tare;
  IF v_net <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'message',
      format('Weight must exceed the %s kg tare for %s.', v_tare, v_type_name));
  END IF;

  SELECT * INTO v_plant FROM plants ORDER BY id LIMIT 1;

  INSERT INTO doc_sequences(key, prefix, last_value)
  VALUES ('CRATE-' || to_char(p_production_date,'YYYYMMDD'), 'CRATE', 1)
  ON CONFLICT (key) DO UPDATE SET last_value = doc_sequences.last_value + 1
  RETURNING last_value INTO v_seq;

  v_no := v_plant.code || '-' || to_char(p_production_date,'YYYYMMDD')
          || '-' || lpad(v_seq::text, 4, '0') || '-P1';

  INSERT INTO crates (crate_no, plant_id, product_id, crate_type_id, production_date,
                      expiry_date, heads, gross_weight_kg, tare_weight_kg, net_weight_kg,
                      status, weighed_at, weighed_by)
  VALUES (v_no, v_plant.id, p_product_id, p_crate_type_id, p_production_date,
          CASE WHEN v_shelf IS NULL THEN NULL ELSE p_production_date + v_shelf END,
          p_heads, p_weight_kg, v_tare, v_net, 'production', now(), u.id)
  RETURNING id INTO v_crate_id;

  INSERT INTO weighing_records (crate_id, product_id, crate_type_id, production_date,
                                heads, gross_weight_kg, tare_weight_kg, net_weight_kg,
                                weighed_at, weighed_by)
  VALUES (v_crate_id, p_product_id, p_crate_type_id, p_production_date,
          p_heads, p_weight_kg, v_tare, v_net, now(), u.id);

  -- The crate is INSERTed as 'production', so the AFTER UPDATE trigger does
  -- not fire; record the originating movement explicitly.
  INSERT INTO crate_movements (crate_id, kind, to_status, weight_kg, user_id, ref_table, ref_no)
  VALUES (v_crate_id, 'bd_weighing', 'production', v_net, u.id, 'weighing_records', v_no);

  PERFORM rpc_log(u.id, 'Basic Dressing', 'weigh', 'crates', v_crate_id::text,
    format('Weighed %s · %s · %s kg · %s heads', v_no, v_sku, v_net, p_heads));

  RETURN jsonb_build_object('ok', true, 'message', 'Saved',
    'crateNo', v_no, 'netKg', v_net, 'crateId', v_crate_id);
END $$;

CREATE OR REPLACE FUNCTION rpc_delete_weighing(p_crate_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; v_no text; v_status text;
BEGIN
  u := rpc_require('bd.weighing.delete');

  SELECT crate_no, status::text INTO v_no, v_status FROM crates WHERE id = p_crate_id;
  IF v_no IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Crate not found.');
  END IF;
  IF v_status <> 'production' THEN
    RETURN jsonb_build_object('ok', false, 'message',
      format('%s has already moved to %s and cannot be deleted here.',
             v_no, replace(v_status,'_',' ')));
  END IF;

  UPDATE weighing_records SET is_deleted = true, deleted_by = u.id, deleted_at = now()
   WHERE crate_id = p_crate_id;
  UPDATE crates SET is_voided = true, status = 'voided' WHERE id = p_crate_id;

  PERFORM rpc_log(u.id, 'Basic Dressing', 'delete', 'crates', p_crate_id::text,
    format('Voided weighing record %s', v_no));

  RETURN jsonb_build_object('ok', true, 'message', 'Voided', 'crateNo', v_no);
END $$;

-- ---------------------------------------------------------------------------
-- CRATE MOVEMENT — the single chokepoint for the whole lifecycle
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rpc_move_crate(
  p_crate_no text,
  p_to_status text,
  p_permission text,
  p_location_id int DEFAULT NULL,
  p_pallet_id bigint DEFAULT NULL,
  p_expect_from text[] DEFAULT NULL,
  p_ref_table text DEFAULT NULL,
  p_ref_id bigint DEFAULT NULL,
  p_ref_no text DEFAULT NULL,
  p_module text DEFAULT 'Warehouse')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  u users; c crates; v_sku text; v_allowed text[];
BEGIN
  u := rpc_require(p_permission);

  SELECT * INTO c FROM crates WHERE crate_no = btrim(p_crate_no);
  IF c.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', format('Unknown crate %s', p_crate_no));
  END IF;

  SELECT sku INTO v_sku FROM products WHERE id = c.product_id;

  IF c.is_voided THEN
    RETURN jsonb_build_object('ok', false, 'message', format('%s is voided', c.crate_no),
      'crateNo', c.crate_no, 'sku', v_sku);
  END IF;

  IF c.status::text = p_to_status THEN
    RETURN jsonb_build_object('ok', false,
      'message', format('Already %s', replace(p_to_status,'_',' ')),
      'crateNo', c.crate_no, 'sku', v_sku, 'weightKg', c.net_weight_kg);
  END IF;

  IF p_expect_from IS NOT NULL AND NOT (c.status::text = ANY(p_expect_from)) THEN
    RETURN jsonb_build_object('ok', false,
      'message', format('Crate is %s — expected %s',
        replace(c.status::text,'_',' '),
        array_to_string(ARRAY(SELECT replace(x,'_',' ') FROM unnest(p_expect_from) x), ' or ')),
      'crateNo', c.crate_no, 'sku', v_sku, 'weightKg', c.net_weight_kg);
  END IF;

  -- The lifecycle, enforced in the database rather than the browser.
  v_allowed := CASE c.status::text
    WHEN 'production'      THEN ARRAY['warehouse','voided']
    WHEN 'warehouse'       THEN ARRAY['storage','cutting','issued_to_fps','picked']
    WHEN 'storage'         THEN ARRAY['cutting','issued_to_fps','picked','warehouse']
    WHEN 'cutting'         THEN ARRAY['wh_received_cut']
    WHEN 'issued_to_fps'   THEN ARRAY['fps_processed']
    WHEN 'fps_processed'   THEN ARRAY['storage','picked']
    WHEN 'wh_received_cut' THEN ARRAY['storage','picked']
    WHEN 'picked'          THEN ARRAY['dispatched','storage']
    ELSE ARRAY[]::text[] END;

  IF NOT (p_to_status = ANY(v_allowed)) THEN
    RETURN jsonb_build_object('ok', false,
      'message', format('Cannot go %s → %s',
        replace(c.status::text,'_',' '), replace(p_to_status,'_',' ')),
      'crateNo', c.crate_no, 'sku', v_sku, 'weightKg', c.net_weight_kg);
  END IF;

  IF is_locked('crates', NULL, c.production_date) THEN
    RETURN jsonb_build_object('ok', false,
      'message', format('Production date is locked — cannot move %s', c.crate_no),
      'crateNo', c.crate_no, 'sku', v_sku, 'weightKg', c.net_weight_kg);
  END IF;

  UPDATE crates
     SET status = p_to_status::crate_status,
         location_id = COALESCE(p_location_id, location_id),
         pallet_id = CASE WHEN p_pallet_id IS NULL THEN pallet_id ELSE p_pallet_id END
   WHERE id = c.id;

  -- Stamp the actor onto the row the trigger just wrote.
  UPDATE crate_movements
     SET user_id = u.id, ref_table = p_ref_table, ref_id = p_ref_id, ref_no = p_ref_no
   WHERE id = (SELECT max(id) FROM crate_movements WHERE crate_id = c.id);

  PERFORM rpc_log(u.id, p_module, 'move', 'crates', c.id::text,
    format('%s %s → %s%s', c.crate_no, c.status, p_to_status,
           COALESCE(' (' || p_ref_no || ')', '')));

  RETURN jsonb_build_object('ok', true,
    'message', format('%s → %s', replace(c.status::text,'_',' '), replace(p_to_status,'_',' ')),
    'crateNo', c.crate_no, 'sku', v_sku, 'weightKg', c.net_weight_kg, 'toStatus', p_to_status);
END $$;

-- ---------------------------------------------------------------------------
-- PALLETS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rpc_open_pallet(p_kind text DEFAULT 'bd')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; v_no text; v_id bigint; v_plant int;
BEGIN
  u := rpc_require('wh.pallet.manage');
  SELECT id INTO v_plant FROM plants ORDER BY id LIMIT 1;
  v_no := next_doc_no('PLT');
  INSERT INTO pallets (pallet_no, plant_id, kind, status, built_by)
  VALUES (v_no, v_plant, p_kind, 'open', u.id) RETURNING id INTO v_id;
  PERFORM rpc_log(u.id, 'Warehouse', 'create', 'pallets', v_id::text,
    format('Opened pallet %s', v_no));
  RETURN jsonb_build_object('ok', true, 'message', 'Pallet opened',
    'palletId', v_id, 'palletNo', v_no);
END $$;

CREATE OR REPLACE FUNCTION rpc_add_crate_to_pallet(p_crate_no text, p_pallet_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; c crates; v_sku text; v_pno text; v_pstatus text;
BEGIN
  u := rpc_require('wh.pallet.manage');

  SELECT pallet_no, status INTO v_pno, v_pstatus FROM pallets WHERE id = p_pallet_id;
  IF v_pno IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Pallet not found.');
  END IF;
  IF v_pstatus <> 'open' THEN
    RETURN jsonb_build_object('ok', false,
      'message', format('Pallet %s is %s, not open.', v_pno, v_pstatus));
  END IF;

  SELECT * INTO c FROM crates WHERE crate_no = btrim(p_crate_no) AND NOT is_voided;
  IF c.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', format('Unknown crate %s', p_crate_no));
  END IF;
  SELECT sku INTO v_sku FROM products WHERE id = c.product_id;

  IF c.status <> 'warehouse' THEN
    RETURN jsonb_build_object('ok', false,
      'message', format('Crate is %s — receive it at the scan station first',
                        replace(c.status::text,'_',' ')),
      'crateNo', c.crate_no, 'sku', v_sku);
  END IF;
  IF c.pallet_id = p_pallet_id THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Already on this pallet',
      'crateNo', c.crate_no, 'sku', v_sku);
  END IF;

  UPDATE crates SET pallet_id = p_pallet_id WHERE id = c.id;
  UPDATE crate_movements SET user_id = u.id, ref_table = 'pallets', ref_no = v_pno
   WHERE id = (SELECT max(id) FROM crate_movements WHERE crate_id = c.id);

  RETURN jsonb_build_object('ok', true, 'message', format('Added to %s', v_pno),
    'crateNo', c.crate_no, 'sku', v_sku, 'weightKg', c.net_weight_kg);
END $$;

CREATE OR REPLACE FUNCTION rpc_close_pallet(p_pallet_id bigint, p_slot_id int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  u users; v_no text; v_count int; v_slot text; v_taken boolean; v_avail boolean;
  r record; v_moved int := 0;
BEGIN
  u := rpc_require('wh.pallet.manage');

  SELECT pallet_no, crate_count INTO v_no, v_count FROM pallets WHERE id = p_pallet_id;
  IF v_no IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Pallet not found.'); END IF;
  IF v_count = 0 THEN RETURN jsonb_build_object('ok', false, 'message', 'Pallet is empty.'); END IF;

  SELECT l.code,
         EXISTS (SELECT 1 FROM pallets p WHERE p.location_id = l.id
                   AND p.status <> 'dispatched' AND p.id <> p_pallet_id),
         COALESCE(sr.is_available, true)
    INTO v_slot, v_taken, v_avail
    FROM locations l LEFT JOIN storage_rooms sr ON sr.id = l.storage_room_id
   WHERE l.id = p_slot_id AND l.is_slot AND l.is_active;

  IF v_slot IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Slot not found.'); END IF;
  IF v_taken THEN
    RETURN jsonb_build_object('ok', false, 'message', format('Slot %s is already occupied.', v_slot));
  END IF;
  IF NOT v_avail THEN
    RETURN jsonb_build_object('ok', false,
      'message', format('Room is OFF — %s cannot accept pallets.', v_slot));
  END IF;

  UPDATE pallets SET status='stored', location_id = p_slot_id, closed_at = now()
   WHERE id = p_pallet_id;

  FOR r IN SELECT crate_no FROM crates WHERE pallet_id = p_pallet_id AND NOT is_voided
  LOOP
    IF (rpc_move_crate(r.crate_no, 'storage', 'wh.pallet.manage', p_slot_id,
                       NULL, NULL, 'pallets', p_pallet_id, v_no, 'Warehouse') ->> 'ok')::boolean
    THEN v_moved := v_moved + 1; END IF;
  END LOOP;

  PERFORM rpc_log(u.id, 'Warehouse', 'putaway', 'pallets', p_pallet_id::text,
    format('Put away %s (%s crates) into %s', v_no, v_moved, v_slot));

  RETURN jsonb_build_object('ok', true,
    'message', format('Put away %s into %s', v_no, v_slot),
    'palletNo', v_no, 'slotCode', v_slot, 'crates', v_moved);
END $$;

CREATE OR REPLACE FUNCTION rpc_move_pallet(p_pallet_no text, p_slot_id int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  u users; v_id bigint; v_no text; v_status text; v_loc int; v_wt numeric;
  v_slot text; v_taken boolean; v_avail boolean; r record; v_moved int := 0; v_total int := 0;
BEGIN
  u := rpc_require('wh.transfer.manage');

  SELECT id, pallet_no, status, location_id, total_weight_kg
    INTO v_id, v_no, v_status, v_loc, v_wt
    FROM pallets WHERE pallet_no = btrim(p_pallet_no);
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', format('Unknown pallet %s', p_pallet_no));
  END IF;
  IF v_status = 'dispatched' THEN
    RETURN jsonb_build_object('ok', false,
      'message', format('%s has already been dispatched.', v_no));
  END IF;
  IF v_loc = p_slot_id THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Pallet is already in that slot.',
      'crateNo', v_no);
  END IF;

  SELECT l.code,
         EXISTS (SELECT 1 FROM pallets p WHERE p.location_id = l.id
                   AND p.status <> 'dispatched' AND p.id <> v_id),
         COALESCE(sr.is_available, true)
    INTO v_slot, v_taken, v_avail
    FROM locations l LEFT JOIN storage_rooms sr ON sr.id = l.storage_room_id
   WHERE l.id = p_slot_id AND l.is_slot AND l.is_active;

  IF v_slot IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Slot not found.'); END IF;
  IF v_taken THEN
    RETURN jsonb_build_object('ok', false, 'message', format('Slot %s is already occupied.', v_slot));
  END IF;
  IF NOT v_avail THEN
    RETURN jsonb_build_object('ok', false,
      'message', format('Room is OFF — %s cannot accept pallets.', v_slot));
  END IF;

  UPDATE pallets SET location_id = p_slot_id WHERE id = v_id;

  FOR r IN SELECT crate_no FROM crates WHERE pallet_id = v_id AND NOT is_voided
  LOOP
    v_total := v_total + 1;
    IF (rpc_move_crate(r.crate_no, 'storage', 'wh.transfer.manage', p_slot_id,
                       NULL, NULL, 'pallets', v_id, v_no, 'Warehouse') ->> 'ok')::boolean
    THEN v_moved := v_moved + 1; END IF;
  END LOOP;

  PERFORM rpc_log(u.id, 'Warehouse', 'transfer', 'pallets', v_id::text,
    format('Moved pallet %s (%s crates) to %s', v_no, v_moved, v_slot));

  RETURN jsonb_build_object('ok', true,
    'message', format('Moved %s/%s crates to %s', v_moved, v_total, v_slot),
    'crateNo', v_no, 'weightKg', v_wt);
END $$;

-- ---------------------------------------------------------------------------
-- ACCOUNT
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rpc_my_profile()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; v_role record; v_perms text[];
BEGIN
  SELECT * INTO u FROM current_app_user();
  IF u.id IS NULL THEN RETURN jsonb_build_object('signedIn', false); END IF;

  SELECT code, name INTO v_role FROM roles WHERE id = u.role_id;

  SELECT COALESCE(array_agg(p.code), ARRAY[]::text[]) INTO v_perms
    FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
   WHERE rp.role_id = u.role_id;

  RETURN jsonb_build_object(
    'signedIn', true,
    'id', u.id, 'email', u.email, 'fullName', u.full_name,
    'employeeNo', u.employee_no, 'department', u.department, 'plantId', u.plant_id,
    'roleCode', COALESCE(v_role.code,'viewer'), 'roleName', COALESCE(v_role.name,'Viewer'),
    'permissions', to_jsonb(v_perms),
    'lastLoginAt', u.last_login_at);
END $$;

CREATE OR REPLACE FUNCTION rpc_touch_login()
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  UPDATE users SET last_login_at = now() WHERE auth_user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION
  rpc_save_weighing(int,int,date,numeric,int),
  rpc_delete_weighing(bigint),
  rpc_move_crate(text,text,text,int,bigint,text[],text,bigint,text,text),
  rpc_open_pallet(text),
  rpc_add_crate_to_pallet(text,bigint),
  rpc_close_pallet(bigint,int),
  rpc_move_pallet(text,int),
  rpc_my_profile(),
  rpc_touch_login()
TO authenticated;

-- rpc_require / rpc_log are internal helpers; the client must not call them.
REVOKE EXECUTE ON FUNCTION rpc_require(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION rpc_log(uuid,text,text,text,text,text) FROM anon, authenticated;
