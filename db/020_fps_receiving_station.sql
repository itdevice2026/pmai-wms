-- FPS Receiving Station (mirror of applied migrations fps_received_by +
-- rpc_fps_receive_station): scan an FPS label to receive it back from FPS
-- into the warehouse, optionally packing onto an open FPS pallet in one step.
ALTER TABLE crates ADD COLUMN IF NOT EXISTS fps_received_by uuid REFERENCES users(id);

CREATE OR REPLACE FUNCTION rpc_fps_receive(p_code text, p_pallet_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  u users; c crates; v_pno text; v_pstatus text; v_msg text;
BEGIN
  u := rpc_require('wh.receiving.manage');

  SELECT * INTO c FROM crates WHERE crate_no = btrim(p_code);
  IF c.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'action', 'unknown',
      'message', format('Unknown code %s', btrim(p_code)));
  END IF;
  IF c.is_voided THEN
    RETURN jsonb_build_object('ok', false, 'action', 'skipped',
      'message', format('%s is voided', c.crate_no), 'crateNo', c.crate_no);
  END IF;
  IF c.fps_customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'action', 'skipped',
      'message', format('%s is not an FPS label — use the FPS Scan Station', c.crate_no),
      'crateNo', c.crate_no);
  END IF;
  IF c.fps_received_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'action', 'skipped',
      'message', format('%s already received at %s', c.crate_no,
                        to_char(c.fps_received_at, 'HH24:MI')),
      'crateNo', c.crate_no, 'sku', c.fps_band);
  END IF;

  IF p_pallet_id IS NOT NULL THEN
    SELECT pallet_no, status INTO v_pno, v_pstatus FROM pallets WHERE id = p_pallet_id;
    IF v_pno IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'action', 'skipped', 'message', 'Pallet not found.');
    END IF;
    IF v_pstatus <> 'open' THEN
      RETURN jsonb_build_object('ok', false, 'action', 'skipped',
        'message', format('Pallet %s is %s, not open.', v_pno, v_pstatus));
    END IF;
  END IF;

  UPDATE crates
     SET fps_received_at = now(), fps_received_by = u.id,
         pallet_id = COALESCE(p_pallet_id, pallet_id)
   WHERE id = c.id;

  IF p_pallet_id IS NOT NULL THEN
    UPDATE pallets SET crate_count = 0, total_weight_kg = 0 WHERE id = p_pallet_id;
    UPDATE pallets p SET crate_count = s.cnt, total_weight_kg = s.wt
      FROM (SELECT pallet_id, count(*) cnt, COALESCE(sum(net_weight_kg),0) wt
              FROM crates WHERE pallet_id = p_pallet_id AND NOT is_voided
             GROUP BY pallet_id) s
     WHERE p.id = s.pallet_id;
    v_msg := format('%s received → packed onto %s', c.crate_no, v_pno);
  ELSE
    v_msg := format('%s received in FPS', c.crate_no);
  END IF;

  PERFORM rpc_log(u.id, 'FPS', 'receive', 'crates', c.id::text, v_msg);
  RETURN jsonb_build_object('ok', true, 'action', 'received', 'message', v_msg,
    'crateNo', c.crate_no, 'sku', c.fps_band, 'weightKg', c.net_weight_kg);
END $$;

GRANT EXECUTE ON FUNCTION rpc_fps_receive(text, bigint) TO authenticated;

-- rpc_fps_scan (db/019) also stamps fps_received_by now.
