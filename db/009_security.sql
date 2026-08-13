-- ============================================================================
-- 009 — Security hardening for an internet-facing deployment.
--
-- Login rate limiting is stored in the database rather than in process memory
-- on purpose: on Vercel (or any multi-instance host) each request may hit a
-- different instance, so an in-memory counter would reset constantly and
-- provide no real protection.
-- ============================================================================

CREATE TABLE IF NOT EXISTS login_attempts (
  id          bigserial PRIMARY KEY,
  email       text NOT NULL,
  ip_address  text,
  succeeded   boolean NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_attempts_email_idx
  ON login_attempts(lower(email), attempted_at DESC);
CREATE INDEX IF NOT EXISTS login_attempts_ip_idx
  ON login_attempts(ip_address, attempted_at DESC);

ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts FORCE ROW LEVEL SECURITY;

/**
 * Returns how many seconds the caller must wait before trying again.
 * 0 means "go ahead".
 *
 * Two independent windows so that neither a single account nor a single
 * source address can be hammered:
 *   - 5 failures for one email  in 15 minutes -> lock that email 15 minutes
 *   - 20 failures from one IP   in 15 minutes -> lock that IP    15 minutes
 *
 * Successful logins clear the email's history, so a legitimate user who
 * mistypes a few times and then gets it right is not penalised afterwards.
 */
CREATE OR REPLACE FUNCTION login_retry_after(p_email text, p_ip text)
RETURNS int
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_window   interval := interval '15 minutes';
  v_email_max int := 5;
  v_ip_max    int := 20;
  v_email_fails int;
  v_ip_fails    int;
  v_last     timestamptz;
BEGIN
  SELECT count(*), max(attempted_at) INTO v_email_fails, v_last
    FROM login_attempts
   WHERE lower(email) = lower(p_email)
     AND NOT succeeded
     AND attempted_at > now() - v_window;

  IF v_email_fails >= v_email_max THEN
    RETURN GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_last + v_window - now())))::int);
  END IF;

  IF p_ip IS NOT NULL THEN
    SELECT count(*), max(attempted_at) INTO v_ip_fails, v_last
      FROM login_attempts
     WHERE ip_address = p_ip
       AND NOT succeeded
       AND attempted_at > now() - v_window;

    IF v_ip_fails >= v_ip_max THEN
      RETURN GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_last + v_window - now())))::int);
    END IF;
  END IF;

  RETURN 0;
END $$;

/** Record an attempt; a success wipes that email's failure history. */
CREATE OR REPLACE FUNCTION record_login_attempt(p_email text, p_ip text, p_ok boolean)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO login_attempts (email, ip_address, succeeded)
  VALUES (p_email, p_ip, p_ok);

  IF p_ok THEN
    DELETE FROM login_attempts
     WHERE lower(email) = lower(p_email) AND NOT succeeded;
  END IF;

  -- Opportunistic cleanup so the table cannot grow without bound.
  DELETE FROM login_attempts WHERE attempted_at < now() - interval '30 days';
END $$;
