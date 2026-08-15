-- 016 — Live Bird Receiving write API.
-- One receipt = one truck; the UI groups trucks by date into "sessions".
-- Mirrors the Next.js createReceipt action, including the period-lock check
-- and the DOA/tare validations.
CREATE OR REPLACE FUNCTION rpc_create_lbr_receipt(
  p_grower_id int,
  p_receipt_date date,
  p_heads_received int,
  p_gross_weight_kg numeric,
  p_heads_loaded int DEFAULT 0,
  p_heads_doa int DEFAULT 0,
  p_heads_condemned int DEFAULT 0,
  p_tare_weight_kg numeric DEFAULT 0,
  p_batch_no text DEFAULT NULL,
  p_plate_no text DEFAULT NULL,
  p_driver_name text DEFAULT NULL,
  p_remarks text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  u users; v_no text; v_id bigint;
  v_net numeric; v_live int; v_ave numeric;
BEGIN
  u := rpc_require('bd.live_bird.manage');

  IF p_grower_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Choose a grower.');
  END IF;
  IF p_receipt_date IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Receipt date is required.');
  END IF;
  IF COALESCE(p_heads_received, -1) < 0 OR COALESCE(p_gross_weight_kg, -1) < 0 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Heads and gross weight must be zero or more.');
  END IF;
  IF COALESCE(p_heads_doa,0) > p_heads_received THEN
    RETURN jsonb_build_object('ok', false, 'message', 'DOA cannot exceed heads received.');
  END IF;
  IF COALESCE(p_tare_weight_kg,0) > p_gross_weight_kg THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Tare weight cannot exceed gross weight.');
  END IF;
  IF is_locked('live_bird_receipts', NULL, p_receipt_date) THEN
    RETURN jsonb_build_object('ok', false, 'message',
      p_receipt_date || ' is locked — no new receipts can be posted.');
  END IF;

  v_net  := p_gross_weight_kg - COALESCE(p_tare_weight_kg,0);
  v_live := p_heads_received - COALESCE(p_heads_doa,0);
  v_ave  := CASE WHEN v_live > 0 THEN v_net / v_live END;
  v_no   := next_doc_no('LBR');

  INSERT INTO live_bird_receipts
    (receipt_no, plant_id, grower_id, receipt_date, batch_no, plate_no, driver_name,
     heads_loaded, heads_received, heads_doa, heads_condemned,
     gross_weight_kg, tare_weight_kg, ave_weight_kg, status, received_by, remarks)
  VALUES
    (v_no, (SELECT id FROM plants ORDER BY id LIMIT 1), p_grower_id, p_receipt_date,
     NULLIF(trim(COALESCE(p_batch_no,'')),''), NULLIF(trim(COALESCE(p_plate_no,'')),''),
     NULLIF(trim(COALESCE(p_driver_name,'')),''),
     COALESCE(p_heads_loaded,0), p_heads_received, COALESCE(p_heads_doa,0),
     COALESCE(p_heads_condemned,0),
     p_gross_weight_kg, COALESCE(p_tare_weight_kg,0), v_ave, 'completed', u.id,
     NULLIF(trim(COALESCE(p_remarks,'')),''))
  RETURNING id INTO v_id;

  PERFORM rpc_log(u.id, 'Basic Dressing', 'create', 'live_bird_receipts', v_id::text,
    format('Received %s heads (%s kg) as %s', p_heads_received, round(v_net,2), v_no));

  RETURN jsonb_build_object('ok', true, 'message',
    format('Received %s heads as %s', p_heads_received, v_no),
    'receiptNo', v_no, 'receiptId', v_id);
END $$;

GRANT EXECUTE ON FUNCTION rpc_create_lbr_receipt(
  int, date, int, numeric, int, int, int, numeric, text, text, text, text)
TO authenticated;

-- ---------------------------------------------------------------------------
-- Session model from the live "New Live Bird Receiving" form (15 Aug):
-- one SESSION (receiving date + notes) holds many TRUCK cards saved at once.
-- Per truck: production date, customer name (free text), farm origin, house
-- number, plate, truck scale in/out, birds, DOA heads + DOA weight.
-- scale in maps to gross_weight_kg, scale out to tare_weight_kg, so the
-- generated net_weight_kg is the truck's total weight.
-- Applied to Supabase as migration `lbr_session_model_from_live_form`.
-- ---------------------------------------------------------------------------
ALTER TABLE live_bird_receipts ALTER COLUMN grower_id DROP NOT NULL;
ALTER TABLE live_bird_receipts ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE live_bird_receipts ADD COLUMN IF NOT EXISTS farm_origin  text;
ALTER TABLE live_bird_receipts ADD COLUMN IF NOT EXISTS house_number text;
ALTER TABLE live_bird_receipts ADD COLUMN IF NOT EXISTS production_date date;
ALTER TABLE live_bird_receipts ADD COLUMN IF NOT EXISTS doa_weight_kg numeric(12,3) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION rpc_create_lbr_session(
  p_receipt_date date,
  p_trucks jsonb,
  p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  u users; t jsonb; i int := 0;
  v_in numeric; v_out numeric; v_birds int; v_doa int; v_doa_wt numeric;
  v_no text; v_ids bigint[] := '{}'; v_id bigint;
BEGIN
  u := rpc_require('bd.live_bird.manage');

  IF p_receipt_date IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Receiving date is required.');
  END IF;
  IF p_trucks IS NULL OR jsonb_typeof(p_trucks) <> 'array' OR jsonb_array_length(p_trucks) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Add at least one truck.');
  END IF;
  IF is_locked('live_bird_receipts', NULL, p_receipt_date) THEN
    RETURN jsonb_build_object('ok', false, 'message',
      p_receipt_date || ' is locked — no new receipts can be posted.');
  END IF;

  FOR t IN SELECT * FROM jsonb_array_elements(p_trucks) LOOP
    i := i + 1;
    v_in    := (t->>'scale_in_kg')::numeric;
    v_out   := (t->>'scale_out_kg')::numeric;
    v_birds := (t->>'birds')::int;
    v_doa   := COALESCE((t->>'doa_heads')::int, 0);
    v_doa_wt:= COALESCE((t->>'doa_weight_kg')::numeric, 0);

    IF COALESCE(trim(t->>'customer_name'),'') = '' OR COALESCE(trim(t->>'farm_origin'),'') = ''
       OR COALESCE(trim(t->>'house_number'),'') = '' OR COALESCE(trim(t->>'plate_no'),'') = '' THEN
      RETURN jsonb_build_object('ok', false, 'message',
        format('Truck %s: customer, farm origin, house number and plate are required.', i));
    END IF;
    IF v_in IS NULL OR v_out IS NULL OR v_out < 0 OR v_in <= v_out THEN
      RETURN jsonb_build_object('ok', false, 'message',
        format('Truck %s: scale in must be greater than scale out.', i));
    END IF;
    IF v_birds IS NULL OR v_birds <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'message',
        format('Truck %s: total number of birds must be greater than zero.', i));
    END IF;
    IF v_doa > v_birds THEN
      RETURN jsonb_build_object('ok', false, 'message',
        format('Truck %s: DOA cannot exceed total birds.', i));
    END IF;
    IF v_doa_wt > (v_in - v_out) THEN
      RETURN jsonb_build_object('ok', false, 'message',
        format('Truck %s: DOA weight cannot exceed total weight.', i));
    END IF;

    v_no := next_doc_no('LBR');
    INSERT INTO live_bird_receipts
      (receipt_no, plant_id, receipt_date, production_date,
       customer_name, farm_origin, house_number, plate_no,
       heads_received, heads_doa, doa_weight_kg,
       gross_weight_kg, tare_weight_kg, ave_weight_kg,
       status, received_by, remarks)
    VALUES
      (v_no, (SELECT id FROM plants ORDER BY id LIMIT 1), p_receipt_date,
       COALESCE((t->>'production_date')::date, p_receipt_date),
       trim(t->>'customer_name'), trim(t->>'farm_origin'), trim(t->>'house_number'),
       trim(t->>'plate_no'),
       v_birds, v_doa, v_doa_wt,
       v_in, v_out, round((v_in - v_out) / v_birds, 4),
       'completed', u.id, NULLIF(trim(COALESCE(p_notes,'')),''))
    RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
  END LOOP;

  PERFORM rpc_log(u.id, 'Basic Dressing', 'create', 'live_bird_receipts',
    array_to_string(v_ids, ','),
    format('Receiving session %s: %s truck(s)', p_receipt_date, i));

  RETURN jsonb_build_object('ok', true,
    'message', format('Saved receiving session — %s truck(s).', i),
    'receiptIds', to_jsonb(v_ids));
END $$;

GRANT EXECUTE ON FUNCTION rpc_create_lbr_session(date, jsonb, text) TO authenticated;
