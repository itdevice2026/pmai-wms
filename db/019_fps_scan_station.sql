-- FPS Scan Station: one scan input, two behaviours (mirror of the applied
-- Supabase migration rpc_fps_scan_station).
--   * Warehouse/Storage crate            -> moved to FPS (issued_to_fps)
--   * FPS label (fps_customer_id set)    -> received in FPS (fps_received_at)
ALTER TABLE crates ADD COLUMN IF NOT EXISTS fps_received_at timestamptz;

CREATE OR REPLACE FUNCTION rpc_fps_scan(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  u users; c crates; v_sku text; res jsonb;
BEGIN
  u := rpc_require('fps.station.use');

  SELECT * INTO c FROM crates WHERE crate_no = btrim(p_code);
  IF c.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'action', 'unknown',
      'message', format('Unknown code %s', btrim(p_code)));
  END IF;

  SELECT sku INTO v_sku FROM products WHERE id = c.product_id;

  IF c.is_voided THEN
    RETURN jsonb_build_object('ok', false, 'action', 'skipped',
      'message', format('%s is voided', c.crate_no), 'crateNo', c.crate_no);
  END IF;

  IF c.fps_customer_id IS NOT NULL THEN
    IF c.fps_received_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'action', 'skipped',
        'message', format('%s already received in FPS at %s', c.crate_no,
                          to_char(c.fps_received_at, 'HH24:MI')),
        'crateNo', c.crate_no, 'sku', COALESCE(c.fps_band, v_sku));
    END IF;
    UPDATE crates SET fps_received_at = now() WHERE id = c.id;
    PERFORM rpc_log(u.id, 'FPS', 'receive', 'crates', c.id::text,
      format('%s received in FPS', c.crate_no));
    RETURN jsonb_build_object('ok', true, 'action', 'received',
      'message', format('%s received in FPS', c.crate_no),
      'crateNo', c.crate_no, 'sku', COALESCE(c.fps_band, v_sku),
      'weightKg', c.net_weight_kg);
  END IF;

  res := rpc_move_crate(c.crate_no, 'issued_to_fps', 'fps.station.use',
                        NULL, NULL, ARRAY['warehouse','storage'],
                        NULL, NULL, NULL, 'FPS');
  IF (res->>'ok')::boolean THEN
    RETURN res || jsonb_build_object('action', 'moved',
      'message', format('%s moved to FPS', c.crate_no));
  END IF;
  RETURN res || jsonb_build_object('action', 'skipped');
END $$;

GRANT EXECUTE ON FUNCTION rpc_fps_scan(text) TO authenticated;
