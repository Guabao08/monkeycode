-- PostgreSQL 13+ provides pg_catalog.gen_random_uuid(); no extension is needed.
-- Every mutation takes the singleton capacity lock before reading the database clock.
CREATE SCHEMA execution;
REVOKE ALL ON SCHEMA execution FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION execution.unavailable_result() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT pg_catalog.jsonb_build_object(
    'status', 'service-error',
    'message', 'Execution unavailable. This job will not be retried; reserved quota is not refunded.',
    'implementationComplexityVerified', false
  );
$$;

-- Reconstruct from an exact durable whitelist, never copy provider objects or messages.
CREATE FUNCTION execution.sanitize_result(p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_status text;
  v_feedback jsonb;
  v_safe jsonb;
  v_categories jsonb := '[]'::jsonb;
  v_category jsonb;
  v_cases jsonb := '[]'::jsonb;
  v_actual jsonb;
  v_expected integer;
  v_passed boolean;
  v_all_passed boolean := true;
  v_index integer;
BEGIN
  IF pg_catalog.jsonb_typeof(p_result) IS DISTINCT FROM 'object' THEN
    RETURN execution.unavailable_result();
  END IF;
  v_status := p_result ->> 'status';
  IF v_status IS NULL OR v_status NOT IN
      ('passed', 'wrong-answer', 'compile-error', 'runtime-error', 'resource-limit') THEN
    RETURN execution.unavailable_result();
  END IF;
  v_safe := pg_catalog.jsonb_build_object('status', v_status, 'implementationComplexityVerified', false);
  v_feedback := p_result -> 'feedback';
  IF v_status = 'wrong-answer' AND (v_feedback IS NULL OR v_feedback = 'null'::jsonb) THEN
    RETURN v_safe || pg_catalog.jsonb_build_object(
      'message', 'The returned output did not match the required answer format or value.');
  END IF;
  IF v_status NOT IN ('passed', 'wrong-answer') AND NOT (p_result ? 'feedback') THEN
    RETURN v_safe;
  END IF;
  IF pg_catalog.jsonb_typeof(v_feedback) IS DISTINCT FROM 'object'
      OR (v_feedback ->> 'status') IS DISTINCT FROM
        (CASE WHEN v_status = 'passed' THEN 'passed' ELSE 'wrong-answer' END) THEN
    RETURN execution.unavailable_result();
  END IF;
  IF v_feedback ? 'failureCategories' THEN
    IF pg_catalog.jsonb_typeof(v_feedback -> 'failureCategories') IS DISTINCT FROM 'array' THEN
      RETURN execution.unavailable_result();
    END IF;
    FOR v_category IN SELECT value FROM pg_catalog.jsonb_array_elements(v_feedback -> 'failureCategories') LOOP
      IF pg_catalog.jsonb_typeof(v_category) IS DISTINCT FROM 'string'
          OR (v_category #>> '{}') NOT IN (
            'empty input', 'single-element boundaries', 'upper boundary', 'duplicate handling',
            'insertion between values', 'lower boundary', 'integer extremes', 'large input boundary'
          ) THEN
        RETURN execution.unavailable_result();
      END IF;
      IF NOT (v_categories @> pg_catalog.jsonb_build_array(v_category)) THEN
        v_categories := v_categories || pg_catalog.jsonb_build_array(v_category);
      END IF;
    END LOOP;
    IF (v_status = 'passed') IS DISTINCT FROM (pg_catalog.jsonb_array_length(v_categories) = 0) THEN
      RETURN execution.unavailable_result();
    END IF;
    RETURN v_safe || pg_catalog.jsonb_build_object('feedback', pg_catalog.jsonb_build_object(
      'status', v_feedback ->> 'status', 'failureCategories', v_categories));
  END IF;
  IF v_status NOT IN ('passed', 'wrong-answer')
      OR pg_catalog.jsonb_typeof(v_feedback -> 'cases') IS DISTINCT FROM 'array' THEN
    RETURN execution.unavailable_result();
  END IF;
  IF pg_catalog.jsonb_array_length(v_feedback -> 'cases') <> 3 THEN
    RETURN execution.unavailable_result();
  END IF;
  FOR v_index IN 0..2 LOOP
    v_expected := CASE v_index WHEN 0 THEN 1 WHEN 1 THEN 2 ELSE 0 END;
    v_actual := v_feedback -> 'cases' -> v_index -> 'actual';
    IF pg_catalog.jsonb_typeof(v_actual) = 'number' THEN
      -- JSONB supports numbers beyond finite JavaScript numbers; those are not wire-safe.
      IF pg_catalog.abs((v_actual #>> '{}')::numeric) > 1.7976931348623157e308::numeric THEN
        v_actual := 'null'::jsonb;
      END IF;
    ELSIF pg_catalog.jsonb_typeof(v_actual) IS DISTINCT FROM 'boolean' THEN
      v_actual := 'null'::jsonb;
    END IF;
    v_passed := false;
    IF pg_catalog.jsonb_typeof(v_actual) = 'number' THEN
      v_passed := (v_actual #>> '{}')::numeric = v_expected;
    END IF;
    v_all_passed := v_all_passed AND v_passed;
    v_cases := v_cases || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'index', v_index, 'expected', v_expected, 'actual', v_actual, 'passed', v_passed));
  END LOOP;
  IF (v_status = 'passed') IS DISTINCT FROM v_all_passed THEN
    RETURN execution.unavailable_result();
  END IF;
  RETURN v_safe || pg_catalog.jsonb_build_object('feedback', pg_catalog.jsonb_build_object(
    'status', v_feedback ->> 'status', 'cases', v_cases));
END;
$$;

CREATE TABLE execution.capacity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  occupied_until timestamptz NOT NULL DEFAULT '-infinity'::timestamptz,
  legacy_imported boolean NOT NULL DEFAULT false
);
INSERT INTO execution.capacity (singleton) VALUES (true);

CREATE TABLE execution.jobs (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  invite_id text NOT NULL CHECK (invite_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  state text NOT NULL CHECK (state IN ('running', 'completed')),
  created_at timestamptz NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  result jsonb,
  CHECK ((state = 'running' AND result IS NULL) OR (state = 'completed' AND result IS NOT NULL))
);
CREATE UNIQUE INDEX jobs_one_running ON execution.jobs ((true)) WHERE state = 'running';
CREATE INDEX jobs_created_at ON execution.jobs (created_at);

CREATE TABLE execution.counters (
  scope text NOT NULL CHECK (scope IN ('invite-day', 'global-day', 'month')),
  subject text NOT NULL,
  period date NOT NULL,
  count bigint NOT NULL CHECK (count >= 0),
  PRIMARY KEY (scope, subject, period)
);
CREATE TABLE execution.minute_reservations (
  created_at timestamptz NOT NULL,
  cost integer NOT NULL CHECK (cost IN (1, 9))
);
CREATE INDEX minute_reservations_created_at ON execution.minute_reservations (created_at);

ALTER TABLE execution.capacity ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution.counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution.minute_reservations ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION execution.job_view(p_job execution.jobs) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT pg_catalog.jsonb_build_object(
    'id', (p_job).id,
    'status', (p_job).state,
    'createdAt', pg_catalog.to_char((p_job).created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) || CASE WHEN (p_job).result IS NULL THEN '{}'::jsonb
    ELSE pg_catalog.jsonb_build_object('result', (p_job).result) END;
$$;

-- Called only while holding capacity FOR UPDATE. Expired leases never replay or refund.
-- The uncertainty window is anchored to lease expiry, not the time of a later read.
CREATE FUNCTION execution.reap(p_now timestamptz) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_day date := (p_now AT TIME ZONE 'UTC')::date;
  v_month date := pg_catalog.date_trunc('month', p_now AT TIME ZONE 'UTC')::date;
  v_expired_until timestamptz;
BEGIN
  SELECT pg_catalog.max(j.lease_expires_at + interval '120 seconds') INTO v_expired_until
    FROM execution.jobs AS j WHERE j.state = 'running' AND j.lease_expires_at <= p_now;
  IF v_expired_until IS NOT NULL THEN
    UPDATE execution.capacity SET occupied_until = GREATEST(occupied_until, v_expired_until)
      WHERE singleton;
    UPDATE execution.jobs SET state = 'completed', result = execution.unavailable_result()
      WHERE state = 'running' AND lease_expires_at <= p_now;
  END IF;
  -- Creation-based 24h retention matches the original job store, including on finish.
  DELETE FROM execution.jobs WHERE state = 'completed' AND created_at <= p_now - interval '24 hours';
  DELETE FROM execution.minute_reservations WHERE created_at <= p_now - interval '60 seconds';
  DELETE FROM execution.counters WHERE
    (scope IN ('invite-day', 'global-day') AND period < v_day) OR (scope = 'month' AND period < v_month);
END;
$$;

CREATE FUNCTION public.mc_admit_job(
  p_invite_id text,
  p_action text,
  p_invite_daily_limit integer,
  p_global_daily_limit integer,
  p_monthly_run_limit integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now timestamptz;
  v_day date;
  v_month date;
  v_cost integer;
  v_occupied_until timestamptz;
  v_job execution.jobs;
BEGIN
  IF p_invite_id IS NULL OR p_invite_id !~ '^[A-Za-z0-9_-]{1,64}$'
      OR p_action IS NULL OR p_action NOT IN ('run', 'submit')
      OR p_invite_daily_limit IS NULL OR p_invite_daily_limit <= 0
      OR p_global_daily_limit IS NULL OR p_global_daily_limit <= 0
      OR p_monthly_run_limit IS NULL OR p_monthly_run_limit <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'MC400', MESSAGE = 'Invalid execution admission';
  END IF;
  SELECT c.occupied_until INTO STRICT v_occupied_until FROM execution.capacity AS c WHERE c.singleton FOR UPDATE;
  v_now := pg_catalog.clock_timestamp();
  PERFORM execution.reap(v_now);
  SELECT c.occupied_until INTO STRICT v_occupied_until FROM execution.capacity AS c WHERE c.singleton;
  IF v_occupied_until > v_now OR EXISTS (SELECT 1 FROM execution.jobs AS j WHERE j.state = 'running') THEN
    RAISE EXCEPTION USING ERRCODE = 'MC429', MESSAGE = 'Execution capacity is occupied; no quota was reserved';
  END IF;
  v_day := (v_now AT TIME ZONE 'UTC')::date;
  v_month := pg_catalog.date_trunc('month', v_now AT TIME ZONE 'UTC')::date;
  v_cost := CASE p_action WHEN 'run' THEN 1 ELSE 9 END;
  IF COALESCE((SELECT c.count FROM execution.counters AS c
        WHERE c.scope = 'invite-day' AND c.subject = p_invite_id AND c.period = v_day), 0) >= p_invite_daily_limit
      OR COALESCE((SELECT c.count FROM execution.counters AS c
        WHERE c.scope = 'global-day' AND c.subject = 'all' AND c.period = v_day), 0) >= p_global_daily_limit
      OR COALESCE((SELECT c.count FROM execution.counters AS c
        WHERE c.scope = 'month' AND c.subject = 'all' AND c.period = v_month), 0) > p_monthly_run_limit - v_cost
      OR COALESCE((SELECT pg_catalog.sum(r.cost) FROM execution.minute_reservations AS r), 0) + v_cost > 30 THEN
    RAISE EXCEPTION USING ERRCODE = 'MC429', MESSAGE = 'Execution quota exhausted; no quota was reserved';
  END IF;
  INSERT INTO execution.counters AS current_counter (scope, subject, period, count) VALUES
    ('invite-day', p_invite_id, v_day, 1), ('global-day', 'all', v_day, 1), ('month', 'all', v_month, v_cost)
    ON CONFLICT (scope, subject, period) DO UPDATE SET count = current_counter.count + EXCLUDED.count;
  INSERT INTO execution.minute_reservations (created_at, cost) VALUES (v_now, v_cost);
  INSERT INTO execution.jobs (invite_id, state, created_at, lease_expires_at)
    VALUES (p_invite_id, 'running', v_now, v_now + interval '150 seconds') RETURNING * INTO v_job;
  UPDATE execution.capacity SET occupied_until = v_job.lease_expires_at + interval '120 seconds' WHERE singleton;
  RETURN execution.job_view(v_job);
END;
$$;

CREATE FUNCTION public.mc_get_job(p_invite_id text, p_job_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_job execution.jobs;
BEGIN
  IF p_invite_id IS NULL OR p_invite_id !~ '^[A-Za-z0-9_-]{1,64}$' OR p_job_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'MC400', MESSAGE = 'Invalid execution lookup';
  END IF;
  PERFORM 1 FROM execution.capacity AS c WHERE c.singleton FOR UPDATE;
  PERFORM execution.reap(pg_catalog.clock_timestamp());
  SELECT j.* INTO v_job FROM execution.jobs AS j WHERE j.id = p_job_id AND j.invite_id = p_invite_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN execution.job_view(v_job);
END;
$$;

CREATE FUNCTION public.mc_finish_job(p_job_id uuid, p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_job execution.jobs;
  v_safe jsonb;
  v_now timestamptz;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'MC400', MESSAGE = 'Invalid execution completion';
  END IF;
  PERFORM 1 FROM execution.capacity AS c WHERE c.singleton FOR UPDATE;
  v_now := pg_catalog.clock_timestamp();
  PERFORM execution.reap(v_now);
  SELECT j.* INTO v_job FROM execution.jobs AS j WHERE j.id = p_job_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Both duplicate finish and late workers see the first durable result, never replace it.
  IF v_job.state = 'completed' THEN RETURN execution.job_view(v_job); END IF;
  v_safe := execution.sanitize_result(p_result);
  v_now := pg_catalog.clock_timestamp();
  IF v_job.lease_expires_at <= v_now THEN
    PERFORM execution.reap(v_now);
    SELECT j.* INTO v_job FROM execution.jobs AS j WHERE j.id = p_job_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN execution.job_view(v_job);
  END IF;
  UPDATE execution.jobs SET state = 'completed', result = v_safe WHERE id = p_job_id RETURNING * INTO v_job;
  IF v_safe ->> 'status' <> 'service-error' THEN
    UPDATE execution.capacity SET occupied_until = '-infinity'::timestamptz WHERE singleton;
  ELSE
    UPDATE execution.capacity SET occupied_until = GREATEST(occupied_until, v_now + interval '120 seconds') WHERE singleton;
  END IF;
  RETURN execution.job_view(v_job);
END;
$$;

-- One-off source-free SQLite cutover. The snapshot is never stored as a blob.
CREATE FUNCTION execution.epoch_milliseconds(p_value jsonb) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_value numeric;
BEGIN
  IF pg_catalog.jsonb_typeof(p_value) IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION USING ERRCODE = 'MC400', MESSAGE = 'Invalid legacy execution snapshot';
  END IF;
  v_value := (p_value #>> '{}')::numeric;
  IF v_value < 0 OR v_value > 253402300799999 OR v_value <> pg_catalog.trunc(v_value) THEN
    RAISE EXCEPTION USING ERRCODE = 'MC400', MESSAGE = 'Invalid legacy execution snapshot';
  END IF;
  RETURN pg_catalog.to_timestamp((v_value / 1000)::double precision);
END;
$$;

CREATE FUNCTION public.mc_import_legacy(p_snapshot jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_capacity execution.capacity;
  v_now timestamptz;
  v_day date;
  v_month date;
  v_row jsonb;
  v_id uuid;
  v_created_at timestamptz;
  v_occupied_until timestamptz;
  v_unfinished boolean := false;
  v_period date;
  v_count numeric;
BEGIN
  SELECT c.* INTO STRICT v_capacity FROM execution.capacity AS c WHERE c.singleton FOR UPDATE;
  v_now := pg_catalog.clock_timestamp();
  v_day := (v_now AT TIME ZONE 'UTC')::date;
  v_month := pg_catalog.date_trunc('month', v_now AT TIME ZONE 'UTC')::date;
  IF v_capacity.legacy_imported OR v_capacity.occupied_until > v_now
      OR EXISTS (SELECT 1 FROM execution.jobs)
      OR EXISTS (SELECT 1 FROM execution.counters)
      OR EXISTS (SELECT 1 FROM execution.minute_reservations) THEN
    RAISE EXCEPTION USING ERRCODE = 'MC400', MESSAGE = 'Legacy import requires an unused destination';
  END IF;
  IF pg_catalog.jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object'
      OR NOT (p_snapshot ?& ARRAY['version','jobs','counters','minute_reservations','occupied_until'])
      OR p_snapshot - ARRAY['version','jobs','counters','minute_reservations','occupied_until'] <> '{}'::jsonb
      OR p_snapshot -> 'version' IS DISTINCT FROM '1'::jsonb
      OR pg_catalog.jsonb_typeof(p_snapshot -> 'jobs') IS DISTINCT FROM 'array'
      OR pg_catalog.jsonb_typeof(p_snapshot -> 'counters') IS DISTINCT FROM 'array'
      OR pg_catalog.jsonb_typeof(p_snapshot -> 'minute_reservations') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'MC400', MESSAGE = 'Invalid legacy execution snapshot';
  END IF;
  v_occupied_until := execution.epoch_milliseconds(p_snapshot -> 'occupied_until');
  IF v_occupied_until > v_now + interval '120 seconds' THEN
    RAISE EXCEPTION USING ERRCODE = 'MC400', MESSAGE = 'Invalid legacy execution snapshot';
  END IF;
  FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'jobs') LOOP
    IF pg_catalog.jsonb_typeof(v_row) IS DISTINCT FROM 'object'
        OR NOT (v_row ?& ARRAY['id','invite_id','state','created_at','result'])
        OR v_row - ARRAY['id','invite_id','state','created_at','result'] <> '{}'::jsonb
        OR pg_catalog.jsonb_typeof(v_row -> 'id') IS DISTINCT FROM 'string'
        OR pg_catalog.jsonb_typeof(v_row -> 'invite_id') IS DISTINCT FROM 'string'
        OR (v_row ->> 'invite_id') !~ '^[A-Za-z0-9_-]{1,64}$'
        OR (v_row ->> 'state') IS NULL OR (v_row ->> 'state') NOT IN ('queued','running','finished')
        OR ((v_row ->> 'state') = 'finished' AND pg_catalog.jsonb_typeof(v_row -> 'result') IS DISTINCT FROM 'object')
        OR ((v_row ->> 'state') <> 'finished' AND v_row -> 'result' IS DISTINCT FROM 'null'::jsonb) THEN
      RAISE EXCEPTION USING ERRCODE = 'MC400', MESSAGE = 'Invalid legacy execution snapshot';
    END IF;
    v_id := (v_row ->> 'id')::uuid;
    v_created_at := execution.epoch_milliseconds(v_row -> 'created_at');
    IF v_created_at > v_now THEN
      RAISE EXCEPTION USING ERRCODE = 'MC400', MESSAGE = 'Invalid legacy execution snapshot';
    END IF;
    v_unfinished := v_unfinished OR (v_row ->> 'state') <> 'finished';
    IF v_created_at > v_now - interval '24 hours' THEN
      INSERT INTO execution.jobs (id, invite_id, state, created_at, lease_expires_at, result)
        VALUES (v_id, v_row ->> 'invite_id', 'completed', v_created_at,
          CASE WHEN v_row ->> 'state' = 'finished' THEN v_created_at + interval '150 seconds' ELSE v_now END,
          CASE WHEN v_row ->> 'state' = 'finished' THEN execution.sanitize_result(v_row -> 'result')
            ELSE execution.unavailable_result() END);
    END IF;
  END LOOP;
  FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'counters') LOOP
    IF pg_catalog.jsonb_typeof(v_row) IS DISTINCT FROM 'object'
        OR NOT (v_row ?& ARRAY['scope','subject','period','count'])
        OR v_row - ARRAY['scope','subject','period','count'] <> '{}'::jsonb
        OR (v_row ->> 'scope') IS NULL OR (v_row ->> 'scope') NOT IN ('invite-day','global-day','month')
        OR pg_catalog.jsonb_typeof(v_row -> 'subject') IS DISTINCT FROM 'string'
        OR ((v_row ->> 'scope') = 'invite-day' AND (v_row ->> 'subject') !~ '^[A-Za-z0-9_-]{1,64}$')
        OR ((v_row ->> 'scope') <> 'invite-day' AND (v_row ->> 'subject') <> 'all')
        OR pg_catalog.jsonb_typeof(v_row -> 'period') IS DISTINCT FROM 'string'
        OR pg_catalog.jsonb_typeof(v_row -> 'count') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION USING ERRCODE = 'MC400', MESSAGE = 'Invalid legacy execution snapshot';
    END IF;
    v_count := (v_row ->> 'count')::numeric;
    IF v_count < 0 OR v_count > 9223372036854775807 OR v_count <> pg_catalog.trunc(v_count) THEN
      RAISE EXCEPTION USING ERRCODE = 'MC400', MESSAGE = 'Invalid legacy execution snapshot';
    END IF;
    IF v_row ->> 'scope' = 'month' THEN
      IF (v_row ->> 'period') !~ '^[0-9]{4}-[0-9]{2}$' THEN
        RAISE EXCEPTION USING ERRCODE = 'MC400', MESSAGE = 'Invalid legacy execution snapshot';
      END IF;
      v_period := ((v_row ->> 'period') || '-01')::date;
      IF v_period > v_month THEN
        RAISE EXCEPTION USING ERRCODE = 'MC400', MESSAGE = 'Invalid legacy execution snapshot';
      END IF;
    ELSE
      IF (v_row ->> 'period') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION USING ERRCODE = 'MC400', MESSAGE = 'Invalid legacy execution snapshot';
      END IF;
      v_period := (v_row ->> 'period')::date;
      IF v_period > v_day THEN
        RAISE EXCEPTION USING ERRCODE = 'MC400', MESSAGE = 'Invalid legacy execution snapshot';
      END IF;
    END IF;
    IF ((v_row ->> 'scope') = 'month' AND v_period = v_month)
        OR ((v_row ->> 'scope') <> 'month' AND v_period = v_day) THEN
      INSERT INTO execution.counters (scope, subject, period, count)
        VALUES (v_row ->> 'scope', v_row ->> 'subject', v_period, v_count::bigint);
    END IF;
  END LOOP;
  FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(p_snapshot -> 'minute_reservations') LOOP
    IF pg_catalog.jsonb_typeof(v_row) IS DISTINCT FROM 'object'
        OR NOT (v_row ?& ARRAY['created_at','cost'])
        OR v_row - ARRAY['created_at','cost'] <> '{}'::jsonb
        OR v_row -> 'cost' IS NULL OR v_row -> 'cost' NOT IN ('1'::jsonb,'9'::jsonb) THEN
      RAISE EXCEPTION USING ERRCODE = 'MC400', MESSAGE = 'Invalid legacy execution snapshot';
    END IF;
    v_created_at := execution.epoch_milliseconds(v_row -> 'created_at');
    IF v_created_at > v_now THEN
      RAISE EXCEPTION USING ERRCODE = 'MC400', MESSAGE = 'Invalid legacy execution snapshot';
    END IF;
    IF v_created_at > v_now - interval '60 seconds' THEN
      INSERT INTO execution.minute_reservations (created_at, cost) VALUES (v_created_at, (v_row ->> 'cost')::integer);
    END IF;
  END LOOP;
  UPDATE execution.capacity SET legacy_imported = true,
    occupied_until = GREATEST(v_occupied_until, CASE WHEN v_unfinished THEN v_now + interval '120 seconds' ELSE '-infinity'::timestamptz END)
    WHERE singleton;
  RETURN '{"imported":true}'::jsonb;
EXCEPTION
  WHEN check_violation OR unique_violation OR invalid_text_representation OR numeric_value_out_of_range
      OR datetime_field_overflow OR invalid_datetime_format THEN
    RAISE EXCEPTION USING ERRCODE = 'MC400', MESSAGE = 'Invalid legacy execution snapshot';
END;
$$;

-- Supabase's public-schema default grants must not expose these RPCs to clients.
REVOKE ALL ON ALL TABLES IN SCHEMA execution FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA execution FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA execution FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mc_admit_job(text, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mc_get_job(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mc_finish_job(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mc_import_legacy(jsonb) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION public.mc_admit_job(text, text, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mc_get_job(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mc_finish_job(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mc_import_legacy(jsonb) TO service_role;
