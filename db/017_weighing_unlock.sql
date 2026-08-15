-- 017 — "Unlock operators" toggle on the Weighing Entry screen.
-- app_settings uniqueness is a PARTIAL index (key) WHERE scope='global', so
-- the conflict target must use the partial-index form.
-- Applied to Supabase as `rpc_weighing_date_unlock` + fix.
CREATE OR REPLACE FUNCTION rpc_set_weighing_date_unlock(p_unlocked boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u users;
BEGIN
  u := rpc_require('bd.weighing.unlock_date');
  INSERT INTO app_settings (scope, key, value)
  VALUES ('global', 'weighing.operators_can_edit_date', to_jsonb(p_unlocked))
  ON CONFLICT (key) WHERE scope = 'global'
  DO UPDATE SET value = to_jsonb(p_unlocked), updated_at = now();
  PERFORM rpc_log(u.id, 'Basic Dressing',
    CASE WHEN p_unlocked THEN 'unlock' ELSE 'lock' END,
    'app_settings', 'weighing.operators_can_edit_date',
    CASE WHEN p_unlocked THEN 'Operators may edit the production date'
         ELSE 'Production date locked to today for operators' END);
  RETURN jsonb_build_object('ok', true, 'message',
    CASE WHEN p_unlocked THEN 'Operators unlocked — they can edit the production date.'
         ELSE 'Operators locked to today''s date.' END,
    'unlocked', p_unlocked);
END $$;

GRANT EXECUTE ON FUNCTION rpc_set_weighing_date_unlock(boolean) TO authenticated;
