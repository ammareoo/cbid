-- 0003: operational visibility for administrators without exposing secrets or raw queues.

CREATE TABLE worker_heartbeats (
  worker      text PRIMARY KEY CHECK (length(worker) <= 64),
  last_beat   timestamptz NOT NULL DEFAULT now(),
  last_result jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE worker_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION app.ops_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app.is_admin() THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = 'CB403';
  END IF;
  RETURN jsonb_build_object(
    'activeSessions', (SELECT count(*) FROM sessions WHERE expires_at > now() AND idle_expires_at > now()),
    'emailPending',  (SELECT count(*) FROM email_outbox WHERE status = 'pending'),
    'emailFailed',   (SELECT count(*) FROM email_outbox WHERE status = 'failed'),
    'openQuizAttempts', (SELECT count(*) FROM quiz_attempts WHERE status = 'in_progress'),
    'workers', coalesce((SELECT jsonb_agg(jsonb_build_object('worker', worker, 'lastBeat', last_beat, 'lastResult', last_result))
                         FROM worker_heartbeats), '[]'::jsonb),
    'databaseSizeBytes', pg_database_size(current_database())
  );
END $$;
REVOKE ALL ON FUNCTION app.ops_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ops_status() TO cbid_app;
