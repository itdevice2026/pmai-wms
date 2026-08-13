-- ============================================================================
-- 008 — Fix the movement-kind classification.
--
-- BUG: log_crate_change() picked the movement kind from NEW.status without
-- first checking whether the status had actually changed. Any location or
-- pallet change on a crate sitting in 'warehouse' was therefore logged as
-- another 'wh_receive' (warehouse → warehouse), and the same for putaway,
-- pick, dispatch and so on.
--
-- Effect: attaching a crate to a pallet produced a phantom "received into
-- warehouse" row, inflating Warehouse Records and the crate audit trail with
-- movements that never physically happened.
--
-- FIX: derive the kind from the status transition only when the status really
-- changed; otherwise classify by what did change (pallet vs location).
-- ============================================================================

CREATE OR REPLACE FUNCTION log_crate_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_status_changed boolean := NEW.status   IS DISTINCT FROM OLD.status;
  v_pallet_changed boolean := NEW.pallet_id IS DISTINCT FROM OLD.pallet_id;
  v_loc_changed    boolean := NEW.location_id IS DISTINCT FROM OLD.location_id;
  v_kind movement_kind;
BEGIN
  IF NOT (v_status_changed OR v_pallet_changed OR v_loc_changed) THEN
    RETURN NEW;
  END IF;

  IF v_status_changed THEN
    v_kind := CASE NEW.status
                WHEN 'warehouse'       THEN 'wh_receive'
                WHEN 'storage'         THEN 'putaway'
                WHEN 'issued_to_fps'   THEN 'issue_to_fps'
                WHEN 'fps_processed'   THEN 'fps_receive'
                WHEN 'cutting'         THEN 'cutting_issue'
                WHEN 'wh_received_cut' THEN 'cutting_receive'
                WHEN 'picked'          THEN 'pick'
                WHEN 'dispatched'      THEN 'dispatch'
                WHEN 'voided'          THEN 'adjustment'
                ELSE 'location_transfer'
              END::movement_kind;
  ELSIF v_pallet_changed THEN
    -- Attaching to or detaching from a pallet, status unchanged.
    v_kind := CASE WHEN OLD.pallet_id IS NULL
                   THEN 'bd_pallet_create'
                   ELSE 'pallet_transfer' END::movement_kind;
  ELSE
    v_kind := 'location_transfer'::movement_kind;
  END IF;

  INSERT INTO crate_movements(
    crate_id, kind, from_status, to_status,
    from_location_id, to_location_id, from_pallet_id, to_pallet_id, weight_kg)
  VALUES (
    NEW.id, v_kind, OLD.status, NEW.status,
    OLD.location_id, NEW.location_id, OLD.pallet_id, NEW.pallet_id,
    NEW.net_weight_kg);

  RETURN NEW;
END $$;
