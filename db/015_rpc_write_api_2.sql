-- ============================================================================
-- 015 — Write API, part 2: picklist / issuance / dispatch / pallet management
--        / planning / system screens for the browser build.
--
-- Same contract as 011: the browser has no direct writes; each function is
-- SECURITY DEFINER, re-checks permission via rpc_require(), enforces the
-- lifecycle itself, and returns jsonb {ok, message, ...}.
--
-- Business logic mirrors the Next.js server actions (the reference
-- implementation) plus the live-PMAI rules captured on 15 Aug 2026:
-- picklist cancellation requires a reason; issuances carry a destination
-- queue; pallet dispositions are fps / direct_issuance / locked / dispatch.
-- ============================================================================

-- Columns the live system needs that the clone's tables lacked
ALTER TABLE picklists ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE picklists ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id);
ALTER TABLE picklists ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE issuances ADD COLUMN IF NOT EXISTS destination_id int REFERENCES issuance_destinations(id);

-- ---------------------------------------------------------------------------
-- PICKLIST
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rpc_create_picklist(
  p_customer_id int, p_strategy text DEFAULT 'fefo', p_required_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; v_no text; v_id bigint;
BEGIN
  u := rpc_require('wh.picklist.manage');
  IF p_customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Choose a customer.');
  END IF;
  IF p_strategy NOT IN ('fefo','fifo') THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Strategy must be fefo or fifo.');
  END IF;
  v_no := next_doc_no('PCK');
  INSERT INTO picklists (picklist_no, plant_id, customer_id, strategy, status, required_at, created_by)
  VALUES (v_no, (SELECT id FROM plants ORDER BY id LIMIT 1), p_customer_id, p_strategy,
          'in_progress', p_required_at, u.id)
  RETURNING id INTO v_id;
  PERFORM rpc_log(u.id, 'Warehouse', 'create', 'picklists', v_id::text, 'Opened picklist ' || v_no);
  RETURN jsonb_build_object('ok', true, 'message', 'Opened ' || v_no,
                            'picklistId', v_id, 'picklistNo', v_no);
END $$;

CREATE OR REPLACE FUNCTION rpc_add_picklist_line(
  p_picklist_id bigint, p_product_id int, p_required_kg numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; v_sku text;
BEGIN
  u := rpc_require('wh.picklist.manage');
  IF p_picklist_id IS NULL OR p_product_id IS NULL OR COALESCE(p_required_kg,0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Choose a SKU and enter a positive weight.');
  END IF;
  SELECT sku INTO v_sku FROM products WHERE id = p_product_id;
  INSERT INTO picklist_lines (picklist_id, product_id, required_weight_kg)
  VALUES (p_picklist_id, p_product_id, p_required_kg);
  UPDATE picklists p SET total_weight_kg = s.wt
    FROM (SELECT COALESCE(sum(required_weight_kg),0) wt
            FROM picklist_lines WHERE picklist_id = p_picklist_id) s
   WHERE p.id = p_picklist_id;
  PERFORM rpc_log(u.id, 'Warehouse', 'update', 'picklist_lines', NULL,
                  format('Added %s × %s kg to picklist %s', v_sku, p_required_kg, p_picklist_id));
  RETURN jsonb_build_object('ok', true, 'message', format('Added %s × %s kg', v_sku, p_required_kg));
END $$;

CREATE OR REPLACE FUNCTION rpc_scan_pick(p_crate_no text, p_picklist_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  u users; pl picklists; v_crate crates; v_sku text; v_line_id bigint; res jsonb;
BEGIN
  u := rpc_require('wh.picklist.manage');
  SELECT * INTO pl FROM picklists WHERE id = p_picklist_id;
  IF pl.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Picklist not found.'); END IF;
  IF pl.status::text NOT IN ('draft','in_progress') THEN
    RETURN jsonb_build_object('ok', false, 'message',
      format('Picklist %s is %s.', pl.picklist_no, pl.status));
  END IF;

  SELECT c.* INTO v_crate FROM crates c
   WHERE c.crate_no = trim(p_crate_no) AND NOT c.is_voided;
  IF v_crate.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Unknown crate ' || trim(p_crate_no));
  END IF;
  SELECT sku INTO v_sku FROM products WHERE id = v_crate.product_id;

  SELECT id INTO v_line_id FROM picklist_lines
   WHERE picklist_id = pl.id AND product_id = v_crate.product_id LIMIT 1;
  IF v_line_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', v_sku || ' is not on this picklist',
                              'crateNo', trim(p_crate_no), 'sku', v_sku);
  END IF;

  res := rpc_move_crate(p_crate_no, 'picked', 'wh.picklist.manage', NULL, NULL,
                        ARRAY['warehouse','storage','wh_received_cut','fps_processed'],
                        'picklists', pl.id, pl.picklist_no, 'Warehouse');
  IF NOT (res->>'ok')::boolean THEN RETURN res; END IF;

  INSERT INTO picklist_picks (picklist_line_id, crate_id, weight_kg, picked_by)
  VALUES (v_line_id, v_crate.id, v_crate.net_weight_kg, u.id);
  UPDATE picklist_lines pl2 SET picked_weight_kg = s.wt
    FROM (SELECT COALESCE(sum(weight_kg),0) wt FROM picklist_picks
           WHERE picklist_line_id = v_line_id) s
   WHERE pl2.id = v_line_id;
  UPDATE picklists p SET picked_weight_kg = s.wt
    FROM (SELECT COALESCE(sum(picked_weight_kg),0) wt FROM picklist_lines
           WHERE picklist_id = pl.id) s
   WHERE p.id = pl.id;

  RETURN res || jsonb_build_object('message', 'Picked onto ' || pl.picklist_no);
END $$;

CREATE OR REPLACE FUNCTION rpc_complete_picklist(p_picklist_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; pl picklists;
BEGIN
  u := rpc_require('wh.picklist.manage');
  SELECT * INTO pl FROM picklists WHERE id = p_picklist_id;
  IF pl.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Picklist not found.'); END IF;
  IF COALESCE(pl.picked_weight_kg,0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Nothing has been picked yet.');
  END IF;
  UPDATE picklists SET status='completed', picked_by=u.id WHERE id = pl.id;
  PERFORM rpc_log(u.id, 'Warehouse', 'complete', 'picklists', pl.id::text,
                  'Completed picklist ' || pl.picklist_no);
  RETURN jsonb_build_object('ok', true, 'message', 'Completed ' || pl.picklist_no);
END $$;

-- Live rule: cancelling a picklist requires a typed reason.
CREATE OR REPLACE FUNCTION rpc_cancel_picklist(p_picklist_id bigint, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; pl picklists;
BEGIN
  u := rpc_require('wh.picklist.manage');
  IF COALESCE(trim(p_reason),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'A reason is required to cancel a picklist.');
  END IF;
  SELECT * INTO pl FROM picklists WHERE id = p_picklist_id;
  IF pl.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Picklist not found.'); END IF;
  IF pl.status::text IN ('completed','cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'message',
      format('Picklist %s is already %s.', pl.picklist_no, pl.status));
  END IF;
  UPDATE picklists SET status='cancelled', cancel_reason=trim(p_reason),
                       cancelled_by=u.id, cancelled_at=now()
   WHERE id = pl.id;
  PERFORM rpc_log(u.id, 'Warehouse', 'cancel', 'picklists', pl.id::text,
                  format('Cancelled picklist %s — %s', pl.picklist_no, trim(p_reason)));
  RETURN jsonb_build_object('ok', true, 'message', 'Cancelled ' || pl.picklist_no);
END $$;

-- ---------------------------------------------------------------------------
-- ISSUANCE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rpc_create_issuance(
  p_purpose text, p_customer_id int DEFAULT NULL, p_job_order_id int DEFAULT NULL,
  p_destination_id int DEFAULT NULL, p_remarks text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; v_no text; v_id bigint;
BEGIN
  u := rpc_require('wh.issuance.manage');
  IF p_purpose NOT IN ('fps','cutting','customer','sample','disposal') THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Choose a valid purpose.');
  END IF;
  IF p_purpose = 'customer' AND p_customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Choose a customer for a customer issuance.');
  END IF;
  v_no := next_doc_no('ISS');
  INSERT INTO issuances (issuance_no, plant_id, purpose, customer_id, job_order_id,
                         destination_id, status, requested_by, issued_by, remarks)
  VALUES (v_no, (SELECT id FROM plants ORDER BY id LIMIT 1), p_purpose, p_customer_id,
          p_job_order_id, p_destination_id, 'in_progress', u.id, u.id, NULLIF(trim(COALESCE(p_remarks,'')),''))
  RETURNING id INTO v_id;
  PERFORM rpc_log(u.id, 'Warehouse', 'create', 'issuances', v_id::text,
                  format('Opened issuance %s (%s)', v_no, p_purpose));
  RETURN jsonb_build_object('ok', true, 'message', 'Opened ' || v_no,
                            'issuanceId', v_id, 'issuanceNo', v_no);
END $$;

CREATE OR REPLACE FUNCTION rpc_scan_issuance(p_crate_no text, p_issuance_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  u users; iss issuances; v_crate crates; v_to text; res jsonb;
BEGIN
  u := rpc_require('wh.issuance.manage');
  SELECT * INTO iss FROM issuances WHERE id = p_issuance_id;
  IF iss.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Issuance not found.'); END IF;
  IF iss.status::text NOT IN ('draft','in_progress') THEN
    RETURN jsonb_build_object('ok', false, 'message',
      format('Issuance %s is %s.', iss.issuance_no, iss.status));
  END IF;

  v_to := CASE iss.purpose
            WHEN 'fps' THEN 'issued_to_fps'
            WHEN 'cutting' THEN 'cutting'
            ELSE 'picked' END;

  res := rpc_move_crate(p_crate_no, v_to, 'wh.issuance.manage', NULL, NULL,
                        ARRAY['warehouse','storage','wh_received_cut','fps_processed'],
                        'issuances', iss.id, iss.issuance_no, 'Warehouse');
  IF NOT (res->>'ok')::boolean THEN RETURN res; END IF;

  SELECT c.* INTO v_crate FROM crates c WHERE c.crate_no = trim(p_crate_no);
  INSERT INTO issuance_lines (issuance_id, crate_id, product_id, weight_kg, scanned_at, scanned_by)
  VALUES (iss.id, v_crate.id, v_crate.product_id, v_crate.net_weight_kg, now(), u.id);
  UPDATE issuances i SET crate_count = s.cnt, total_weight_kg = s.wt
    FROM (SELECT count(*) cnt, COALESCE(sum(weight_kg),0) wt
            FROM issuance_lines WHERE issuance_id = iss.id) s
   WHERE i.id = iss.id;

  RETURN res || jsonb_build_object('message', 'Issued on ' || iss.issuance_no);
END $$;

CREATE OR REPLACE FUNCTION rpc_complete_issuance(p_issuance_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; iss issuances;
BEGIN
  u := rpc_require('wh.issuance.manage');
  SELECT * INTO iss FROM issuances WHERE id = p_issuance_id;
  IF iss.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Issuance not found.'); END IF;
  IF COALESCE(iss.crate_count,0) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Issuance has no crates.');
  END IF;
  UPDATE issuances SET status='completed', completed_at=now() WHERE id = iss.id;
  PERFORM rpc_log(u.id, 'Warehouse', 'complete', 'issuances', iss.id::text,
                  format('Completed issuance %s (%s crates)', iss.issuance_no, iss.crate_count));
  RETURN jsonb_build_object('ok', true, 'message', 'Completed ' || iss.issuance_no);
END $$;

-- ---------------------------------------------------------------------------
-- DISPATCH
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rpc_create_dispatch(
  p_customer_id int, p_picklist_id bigint DEFAULT NULL, p_dispatch_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; v_no text; v_id bigint;
BEGIN
  u := rpc_require('wh.dispatch.manage');
  IF p_customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Choose a customer.');
  END IF;
  v_no := next_doc_no('DSP');
  INSERT INTO dispatches (dispatch_no, picklist_id, plant_id, customer_id, dispatch_date, status, released_by)
  VALUES (v_no, p_picklist_id, (SELECT id FROM plants ORDER BY id LIMIT 1), p_customer_id,
          COALESCE(p_dispatch_date, current_date), 'in_progress', u.id)
  RETURNING id INTO v_id;
  PERFORM rpc_log(u.id, 'Warehouse', 'create', 'dispatches', v_id::text, 'Opened dispatch ' || v_no);
  RETURN jsonb_build_object('ok', true, 'message', 'Opened ' || v_no,
                            'dispatchId', v_id, 'dispatchNo', v_no);
END $$;

CREATE OR REPLACE FUNCTION rpc_scan_dispatch(p_crate_no text, p_dispatch_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; d dispatches; v_crate crates; res jsonb;
BEGIN
  u := rpc_require('wh.dispatch.manage');
  SELECT * INTO d FROM dispatches WHERE id = p_dispatch_id;
  IF d.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Dispatch not found.'); END IF;
  IF d.status::text NOT IN ('draft','in_progress') THEN
    RETURN jsonb_build_object('ok', false, 'message',
      format('Dispatch %s is %s.', d.dispatch_no, d.status));
  END IF;

  -- Only picked crates may be loaded — this is what stops unpicked stock
  -- leaving the building.
  res := rpc_move_crate(p_crate_no, 'dispatched', 'wh.dispatch.manage', NULL, NULL,
                        ARRAY['picked'], 'dispatches', d.id, d.dispatch_no, 'Warehouse');
  IF NOT (res->>'ok')::boolean THEN RETURN res; END IF;

  SELECT c.* INTO v_crate FROM crates c WHERE c.crate_no = trim(p_crate_no);
  INSERT INTO dispatch_lines (dispatch_id, crate_id, pallet_id, product_id, weight_kg)
  VALUES (d.id, v_crate.id, v_crate.pallet_id, v_crate.product_id, v_crate.net_weight_kg);
  UPDATE dispatches dd SET total_weight_kg = s.wt
    FROM (SELECT COALESCE(sum(weight_kg),0) wt FROM dispatch_lines WHERE dispatch_id = d.id) s
   WHERE dd.id = d.id;

  RETURN res || jsonb_build_object('message', 'Loaded onto ' || d.dispatch_no);
END $$;

CREATE OR REPLACE FUNCTION rpc_release_dispatch(
  p_dispatch_id bigint, p_dr_no text, p_plate_no text,
  p_driver text DEFAULT NULL, p_truck_temp_c numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; d dispatches; v_crates int;
BEGIN
  u := rpc_require('wh.dispatch.release');
  IF COALESCE(trim(p_dr_no),'') = '' OR COALESCE(trim(p_plate_no),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'DR number and plate are required.');
  END IF;
  SELECT * INTO d FROM dispatches WHERE id = p_dispatch_id;
  IF d.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Dispatch not found.'); END IF;
  SELECT count(*) INTO v_crates FROM dispatch_lines WHERE dispatch_id = d.id;
  IF v_crates = 0 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Nothing has been loaded yet.');
  END IF;
  UPDATE dispatches
     SET dr_no = trim(p_dr_no), plate_no = trim(p_plate_no),
         driver_name = NULLIF(trim(COALESCE(p_driver,'')),''),
         truck_temp_c = p_truck_temp_c,
         status = 'completed', departed_at = now(), checked_by = u.id
   WHERE id = d.id;
  PERFORM rpc_log(u.id, 'Warehouse', 'release', 'dispatches', d.id::text,
                  format('Released %s — DR %s, plate %s, %s crates',
                         d.dispatch_no, trim(p_dr_no), trim(p_plate_no), v_crates));
  RETURN jsonb_build_object('ok', true, 'message',
    format('Released %s (%s crates)', d.dispatch_no, v_crates));
END $$;

-- ---------------------------------------------------------------------------
-- PALLET MANAGEMENT / PLANNING
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rpc_reassign_crate(p_crate_no text, p_pallet_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; v_crate crates; v_from bigint;
BEGIN
  u := rpc_require('wh.transfer.manage');
  SELECT * INTO v_crate FROM crates WHERE crate_no = trim(p_crate_no) AND NOT is_voided;
  IF v_crate.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Unknown crate ' || trim(p_crate_no));
  END IF;
  v_from := v_crate.pallet_id;
  IF p_pallet_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pallets WHERE id = p_pallet_id) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Target pallet not found.');
  END IF;

  UPDATE crates SET pallet_id = p_pallet_id WHERE id = v_crate.id;

  -- Roll both pallets up so counts and weights stay truthful.
  UPDATE pallets p SET crate_count = s.cnt, total_weight_kg = s.wt
    FROM (SELECT count(*) cnt, COALESCE(sum(net_weight_kg),0) wt
            FROM crates WHERE pallet_id = p.id AND NOT is_voided) s
   WHERE p.id IN (v_from, p_pallet_id) AND p.id IS NOT NULL;

  PERFORM rpc_log(u.id, 'Warehouse', 'transfer', 'crates', v_crate.id::text,
    format('Moved crate %s from pallet %s to %s',
           v_crate.crate_no, COALESCE(v_from::text,'—'), COALESCE(p_pallet_id::text,'—')));
  RETURN jsonb_build_object('ok', true, 'message',
    CASE WHEN p_pallet_id IS NULL
         THEN format('Removed %s from its pallet', v_crate.crate_no)
         ELSE format('Moved %s to pallet %s', v_crate.crate_no, p_pallet_id) END);
END $$;

CREATE OR REPLACE FUNCTION rpc_merge_pallets(p_source_ids bigint[], p_target_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; v_moved int;
BEGIN
  u := rpc_require('wh.transfer.manage');
  IF p_target_id IS NULL OR p_source_ids IS NULL OR array_length(p_source_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Choose source pallets and a target.');
  END IF;
  IF p_target_id = ANY(p_source_ids) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Target pallet cannot be one of the sources.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pallets WHERE id = p_target_id) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Target pallet not found.');
  END IF;

  UPDATE crates SET pallet_id = p_target_id
   WHERE pallet_id = ANY(p_source_ids) AND NOT is_voided;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  UPDATE pallets p SET crate_count = s.cnt, total_weight_kg = s.wt
    FROM (SELECT count(*) cnt, COALESCE(sum(net_weight_kg),0) wt
            FROM crates WHERE pallet_id = p.id AND NOT is_voided) s
   WHERE p.id = p_target_id OR p.id = ANY(p_source_ids);

  UPDATE pallets SET status = 'merged' WHERE id = ANY(p_source_ids);

  PERFORM rpc_log(u.id, 'Warehouse', 'merge', 'pallets', p_target_id::text,
    format('Merged %s crate(s) from pallet(s) %s into %s',
           v_moved, array_to_string(p_source_ids, ', '), p_target_id));
  RETURN jsonb_build_object('ok', true, 'message',
    format('Merged %s crate(s) into pallet %s', v_moved, p_target_id));
END $$;

-- Live dispositions: -> FPS, -> Direct Issuance (stays in warehouse), Lock,
-- Undo (for dispatch). Also split/merge/cutting for completeness.
CREATE OR REPLACE FUNCTION rpc_set_pallet_disposition(p_pallet_id bigint, p_disposition text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; pl pallets;
BEGIN
  u := rpc_require('plan.disposition.manage');
  IF p_disposition IS NOT NULL AND p_disposition NOT IN
     ('fps','direct_issuance','locked','dispatch','cutting','split','merged') THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Invalid disposition.');
  END IF;
  SELECT * INTO pl FROM pallets WHERE id = p_pallet_id;
  IF pl.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Pallet not found.'); END IF;
  UPDATE pallets SET disposition = p_disposition WHERE id = pl.id;
  PERFORM rpc_log(u.id, 'Planning', 'disposition', 'pallets', pl.id::text,
    format('Pallet %s → %s', pl.pallet_no, COALESCE(p_disposition, 'cleared')));
  RETURN jsonb_build_object('ok', true, 'message',
    format('Pallet %s tagged %s', pl.pallet_no, COALESCE(p_disposition, '(cleared)')));
END $$;

-- Live "Delete Pallet" with an explicit, separate choice to also remove the
-- crates. Crates are voided rather than erased so the audit trail survives.
CREATE OR REPLACE FUNCTION rpc_delete_pallet(p_pallet_id bigint, p_delete_crates boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; pl pallets; v_crates int;
BEGIN
  u := rpc_require('wh.pallet.manage');
  SELECT * INTO pl FROM pallets WHERE id = p_pallet_id;
  IF pl.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Pallet not found.'); END IF;
  SELECT count(*) INTO v_crates FROM crates WHERE pallet_id = pl.id AND NOT is_voided;

  IF p_delete_crates THEN
    UPDATE crates SET is_voided = true, pallet_id = NULL WHERE pallet_id = pl.id;
  ELSE
    UPDATE crates SET pallet_id = NULL WHERE pallet_id = pl.id;
  END IF;

  DELETE FROM pallets WHERE id = pl.id;

  PERFORM rpc_log(u.id, 'Warehouse', 'delete', 'pallets', pl.id::text,
    format('Deleted pallet %s (%s crates %s)', pl.pallet_no, v_crates,
           CASE WHEN p_delete_crates THEN 'voided' ELSE 'detached' END));
  RETURN jsonb_build_object('ok', true, 'message',
    format('Deleted %s — %s crate(s) %s', pl.pallet_no, v_crates,
           CASE WHEN p_delete_crates THEN 'voided' ELSE 'kept, detached' END));
EXCEPTION WHEN foreign_key_violation THEN
  RETURN jsonb_build_object('ok', false, 'message',
    'Pallet is referenced by other records (picklist or dispatch) and cannot be deleted.');
END $$;

-- Live rule: exceeding the 24-crate cap demands a typed reason.
CREATE OR REPLACE FUNCTION rpc_set_over_capacity_reason(p_pallet_id bigint, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; pl pallets;
BEGIN
  u := rpc_require('wh.pallet.manage');
  IF COALESCE(trim(p_reason),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'A reason is required.');
  END IF;
  SELECT * INTO pl FROM pallets WHERE id = p_pallet_id;
  IF pl.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Pallet not found.'); END IF;
  UPDATE pallets SET over_capacity_reason = trim(p_reason),
                     over_capacity_by = u.id, over_capacity_at = now()
   WHERE id = pl.id;
  PERFORM rpc_log(u.id, 'Warehouse', 'over_capacity', 'pallets', pl.id::text,
    format('Pallet %s over capacity: %s', pl.pallet_no, trim(p_reason)));
  RETURN jsonb_build_object('ok', true, 'message', 'Reason saved.');
END $$;

-- ---------------------------------------------------------------------------
-- SYSTEM: locks, RBAC, per-user overrides
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rpc_create_lock(
  p_entity text, p_from date, p_to date, p_reason text DEFAULT NULL,
  p_basis text DEFAULT 'production_date')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users;
BEGIN
  u := rpc_require('sys.locks.manage');
  IF p_entity IS NULL OR p_from IS NULL OR p_to IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Entity and period are required.');
  END IF;
  IF p_to < p_from THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Period end is before its start.');
  END IF;
  INSERT INTO locked_records (entity, period_from, period_to, reason, locked_by, lock_basis)
  VALUES (p_entity, p_from, p_to, NULLIF(trim(COALESCE(p_reason,'')),''), u.id, p_basis);
  PERFORM rpc_log(u.id, 'System', 'lock', 'locked_records', NULL,
    format('Locked %s for %s → %s', p_entity, p_from, p_to));
  RETURN jsonb_build_object('ok', true, 'message', format('Locked %s.', p_entity));
END $$;

CREATE OR REPLACE FUNCTION rpc_release_lock(p_lock_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; v_entity text;
BEGIN
  u := rpc_require('sys.locks.manage');
  UPDATE locked_records SET is_active = false, unlocked_by = u.id, unlocked_at = now()
   WHERE id = p_lock_id AND is_active
   RETURNING entity INTO v_entity;
  IF v_entity IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Lock not found or already released.');
  END IF;
  PERFORM rpc_log(u.id, 'System', 'unlock', 'locked_records', p_lock_id::text,
                  'Unlocked ' || v_entity);
  RETURN jsonb_build_object('ok', true, 'message', 'Unlocked ' || v_entity || '.');
END $$;

CREATE OR REPLACE FUNCTION rpc_toggle_role_permission(
  p_role_id int, p_permission_id int, p_grant boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; v_role roles; v_perm text;
BEGIN
  u := rpc_require('sys.rbac.manage');
  SELECT * INTO v_role FROM roles WHERE id = p_role_id;
  SELECT code INTO v_perm FROM permissions WHERE id = p_permission_id;
  IF v_role.id IS NULL OR v_perm IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Role or permission not found.');
  END IF;
  -- admin and it are implicitly all-powerful; never create the illusion that
  -- permissions can be revoked from them.
  IF v_role.code IN ('admin','it') THEN
    RETURN jsonb_build_object('ok', false, 'message',
      v_role.name || ' implicitly holds every permission.');
  END IF;
  IF p_grant THEN
    INSERT INTO role_permissions (role_id, permission_id)
    VALUES (p_role_id, p_permission_id) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM role_permissions WHERE role_id = p_role_id AND permission_id = p_permission_id;
  END IF;
  PERFORM rpc_log(u.id, 'System', CASE WHEN p_grant THEN 'grant' ELSE 'revoke' END,
                  'role_permissions', NULL,
                  format('%s %s for %s', CASE WHEN p_grant THEN 'Granted' ELSE 'Revoked' END,
                         v_perm, v_role.name));
  RETURN jsonb_build_object('ok', true, 'message',
    format('%s %s for %s', CASE WHEN p_grant THEN 'Granted' ELSE 'Revoked' END, v_perm, v_role.name));
END $$;

-- Per-user overrides: effect 'grant' | 'deny' | NULL (remove the override).
CREATE OR REPLACE FUNCTION rpc_set_user_override(
  p_user_id uuid, p_permission_id int, p_effect text DEFAULT 'grant')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users; v_perm text; v_name text;
BEGIN
  u := rpc_require('sys.rbac.manage');
  SELECT code INTO v_perm FROM permissions WHERE id = p_permission_id;
  SELECT full_name INTO v_name FROM users WHERE id = p_user_id;
  IF v_perm IS NULL OR v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'User or permission not found.');
  END IF;
  IF p_effect IS NULL THEN
    DELETE FROM user_permission_overrides
     WHERE user_id = p_user_id AND permission_id = p_permission_id;
    PERFORM rpc_log(u.id, 'System', 'override_clear', 'user_permission_overrides', NULL,
                    format('Cleared %s override for %s', v_perm, v_name));
    RETURN jsonb_build_object('ok', true, 'message', format('Cleared %s for %s', v_perm, v_name));
  END IF;
  IF p_effect NOT IN ('grant','deny') THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Effect must be grant, deny, or null.');
  END IF;
  INSERT INTO user_permission_overrides (user_id, permission_id, effect, granted_by)
  VALUES (p_user_id, p_permission_id, p_effect, u.id)
  ON CONFLICT (user_id, permission_id)
  DO UPDATE SET effect = EXCLUDED.effect, granted_by = EXCLUDED.granted_by, granted_at = now();
  PERFORM rpc_log(u.id, 'System', 'override_' || p_effect, 'user_permission_overrides', NULL,
                  format('%s %s for %s', initcap(p_effect), v_perm, v_name));
  RETURN jsonb_build_object('ok', true, 'message',
    format('%s %s for %s', initcap(p_effect), v_perm, v_name));
END $$;

-- ---------------------------------------------------------------------------
-- GRANTS — execution only; the functions check permissions themselves.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION
  rpc_create_picklist(int, text, timestamptz),
  rpc_add_picklist_line(bigint, int, numeric),
  rpc_scan_pick(text, bigint),
  rpc_complete_picklist(bigint),
  rpc_cancel_picklist(bigint, text),
  rpc_create_issuance(text, int, int, int, text),
  rpc_scan_issuance(text, bigint),
  rpc_complete_issuance(bigint),
  rpc_create_dispatch(int, bigint, date),
  rpc_scan_dispatch(text, bigint),
  rpc_release_dispatch(bigint, text, text, text, numeric),
  rpc_reassign_crate(text, bigint),
  rpc_merge_pallets(bigint[], bigint),
  rpc_set_pallet_disposition(bigint, text),
  rpc_delete_pallet(bigint, boolean),
  rpc_set_over_capacity_reason(bigint, text),
  rpc_create_lock(text, date, date, text, text),
  rpc_release_lock(bigint),
  rpc_toggle_role_permission(int, int, boolean),
  rpc_set_user_override(uuid, int, text)
TO authenticated;
