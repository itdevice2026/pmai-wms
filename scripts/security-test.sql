-- ============================================================================
-- Security regression suite for the browser-only deployment.
--
-- Impersonates a signed-in browser exactly as PostgREST does, then tries the
-- attacks a client-side app is vulnerable to. Run after any change to RLS,
-- grants or the RPC layer:
--
--   psql "$DATABASE_URL" -f scripts/security-test.sql
--
-- Every row must read PASS.
-- ============================================================================
CREATE TEMP TABLE IF NOT EXISTS sec_results (n int, test text, result text);
TRUNCATE sec_results;
GRANT INSERT, SELECT ON sec_results TO authenticated;

DO $$
DECLARE v_auth uuid; v_res jsonb; v_cnt int; v_crate text;
BEGIN
  SELECT auth_user_id INTO v_auth FROM users WHERE auth_user_id IS NOT NULL LIMIT 1;
  IF v_auth IS NULL THEN
    INSERT INTO sec_results VALUES (0,'setup','SKIP - no auth-linked user'); RETURN;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_cnt FROM products;
  INSERT INTO sec_results VALUES (1,'read reference data',
    CASE WHEN v_cnt > 0 THEN 'PASS' ELSE 'FAIL' END);

  BEGIN
    INSERT INTO crates (crate_no, plant_id, product_id, production_date, net_weight_kg, status)
    VALUES ('SECTEST-1', 1, 1, current_date, 99, 'storage');
    INSERT INTO sec_results VALUES (2,'direct INSERT into crates','FAIL - SECURITY HOLE');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO sec_results VALUES (2,'direct INSERT into crates','PASS');
  END;

  BEGIN
    UPDATE users SET role_id = (SELECT id FROM roles WHERE code='admin');
    INSERT INTO sec_results VALUES (3,'privilege escalation via UPDATE users','FAIL - SECURITY HOLE');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO sec_results VALUES (3,'privilege escalation via UPDATE users','PASS');
  END;

  BEGIN
    DELETE FROM activity_logs;
    INSERT INTO sec_results VALUES (4,'wipe the audit trail','FAIL - SECURITY HOLE');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO sec_results VALUES (4,'wipe the audit trail','PASS');
  END;

  BEGIN
    SELECT count(*) INTO v_cnt FROM login_attempts;
    INSERT INTO sec_results VALUES (5,'read login_attempts','FAIL - leaks lockout budget');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO sec_results VALUES (5,'read login_attempts','PASS');
  END;

  BEGIN
    PERFORM record_login_attempt('someone@example.com','1.2.3.4',true);
    INSERT INTO sec_results VALUES (6,'clear own lockout history','FAIL - defeats rate limiting');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO sec_results VALUES (6,'clear own lockout history','PASS');
  END;

  BEGIN
    PERFORM rpc_log(v_auth,'Forged','hack',NULL,NULL,'fake');
    INSERT INTO sec_results VALUES (7,'forge an audit-log entry','FAIL - SECURITY HOLE');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO sec_results VALUES (7,'forge an audit-log entry','PASS');
  END;

  BEGIN
    PERFORM next_doc_no('PLT');
    INSERT INTO sec_results VALUES (8,'burn document sequence','FAIL - callable');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO sec_results VALUES (8,'burn document sequence','PASS');
  END;

  v_res := rpc_save_weighing((SELECT id FROM products WHERE band_code IS NOT NULL LIMIT 1),
                             (SELECT id FROM crate_types LIMIT 1), current_date, 17.25, 15);
  v_crate := v_res->>'crateNo';
  INSERT INTO sec_results VALUES (9,'sanctioned write via RPC',
    CASE WHEN (v_res->>'ok')::boolean THEN 'PASS' ELSE 'FAIL - '||(v_res->>'message') END);

  v_res := rpc_move_crate(v_crate,'dispatched','wh.dispatch.manage');
  INSERT INTO sec_results VALUES (10,'illegal lifecycle jump',
    CASE WHEN (v_res->>'ok')::boolean THEN 'FAIL - allowed' ELSE 'PASS' END);

  RESET ROLE;
  DELETE FROM crates WHERE crate_no = v_crate OR crate_no LIKE 'SECTEST-%';
END $$;

SELECT n, test, result FROM sec_results ORDER BY n;
