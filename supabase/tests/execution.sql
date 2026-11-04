\set ON_ERROR_STOP on
-- Run after the migration as its owner/superuser, able to SET ROLE to the three
-- supplied API roles. No extensions, pgTAP, provider traffic, or wall-clock sleeps.
-- Every fixture, including temporary assertion helpers, is rolled back.
BEGIN;
SET LOCAL TIME ZONE 'Pacific/Kiritimati';

CREATE FUNCTION pg_temp.assert_true(p_condition boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', p_message; END IF;
END;
$$;

CREATE FUNCTION pg_temp.expect_state(p_sql text, p_state text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_state text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = p_state THEN RETURN; END IF;
    RAISE EXCEPTION 'Expected SQLSTATE %, received % for %', p_state, v_state, p_sql;
  END;
  RAISE EXCEPTION 'Expected SQLSTATE %, statement succeeded: %', p_state, p_sql;
END;
$$;

CREATE FUNCTION pg_temp.reset_execution() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  TRUNCATE execution.jobs, execution.counters, execution.minute_reservations;
  UPDATE execution.capacity SET occupied_until = '-infinity'::timestamptz, legacy_imported = false WHERE singleton;
END;
$$;

CREATE FUNCTION pg_temp.check_result(p_input jsonb, p_expected jsonb) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_job jsonb; v_finished jsonb;
BEGIN
  PERFORM pg_temp.reset_execution();
  v_job := public.mc_admit_job('sanitize', 'submit', 30, 300, 90000);
  v_finished := public.mc_finish_job((v_job ->> 'id')::uuid, p_input);
  PERFORM pg_temp.assert_true(v_finished ->> 'status' = 'completed', 'finish completes a job');
  PERFORM pg_temp.assert_true(v_finished -> 'result' = p_expected, 'exact sanitized result for ' || p_input::text);
  PERFORM pg_temp.assert_true(public.mc_get_job('sanitize', (v_job ->> 'id')::uuid) = v_finished,
    'GET returns only the same durable sanitized result');
  PERFORM pg_temp.assert_true((SELECT j.result = p_expected FROM execution.jobs AS j
    WHERE j.id = (v_job ->> 'id')::uuid), 'stored result exactly matches whitelist');
END;
$$;

-- Admission shape, DB-generated identity, exact leases, ownership, definitive
-- completion, duplicate fencing, and no reservation on capacity rejection.
DO $$
DECLARE
  v_job jsonb; v_next jsonb; v_finished jsonb;
  v_id uuid; v_before bigint; v_day date; v_month date;
BEGIN
  PERFORM pg_temp.reset_execution();
  v_job := public.mc_admit_job('owner_a', 'run', 30, 300, 90000);
  v_id := (v_job ->> 'id')::uuid;
  PERFORM pg_temp.assert_true(v_job - 'id' - 'createdAt' = '{"status":"running"}'::jsonb,
    'admission has only the JobView envelope');
  PERFORM pg_temp.assert_true(v_job ->> 'createdAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$',
    'createdAt is UTC independent of session time zone');
  PERFORM pg_temp.assert_true((SELECT j.lease_expires_at - j.created_at = interval '150 seconds'
    AND c.occupied_until - j.lease_expires_at = interval '120 seconds'
    FROM execution.jobs AS j CROSS JOIN execution.capacity AS c WHERE j.id = v_id), '150s lease plus 120s quarantine');
  PERFORM pg_temp.assert_true(public.mc_get_job('owner_a', v_id) = v_job, 'owner can recover admitted job');
  PERFORM pg_temp.assert_true(public.mc_get_job('owner_b', v_id) IS NULL, 'another invite cannot read job');
  PERFORM pg_temp.assert_true(public.mc_get_job('owner_a', '00000000-0000-4000-8000-000000000000') IS NULL,
    'unknown job is null');
  SELECT sum(count) INTO v_before FROM execution.counters;
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('owner_b','submit',30,300,90000)$q$, 'MC429');
  PERFORM pg_temp.assert_true((SELECT sum(count) FROM execution.counters) = v_before, 'capacity rejection spends no quota');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM execution.minute_reservations) = 1, 'capacity rejection adds no minute charge');
  v_day := (clock_timestamp() AT TIME ZONE 'UTC')::date;
  v_month := date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')::date;
  PERFORM pg_temp.assert_true((SELECT count FROM execution.counters WHERE scope = 'invite-day'
    AND subject = 'owner_a' AND period = v_day) = 1, 'UTC invite day reserves one job');
  PERFORM pg_temp.assert_true((SELECT count FROM execution.counters WHERE scope = 'global-day'
    AND subject = 'all' AND period = v_day) = 1, 'UTC global day reserves one job');
  PERFORM pg_temp.assert_true((SELECT count FROM execution.counters WHERE scope = 'month'
    AND subject = 'all' AND period = v_month) = 1, 'UTC month reserves run unit');
  v_finished := public.mc_finish_job(v_id, '{"status":"compile-error","message":"SOURCE","implementationComplexityVerified":true}');
  PERFORM pg_temp.assert_true(v_finished -> 'result' = '{"status":"compile-error","implementationComplexityVerified":false}',
    'definitive compile failure has no durable diagnostic');
  v_next := public.mc_admit_job('owner_b', 'run', 30, 300, 90000);
  PERFORM pg_temp.assert_true(public.mc_finish_job(v_id, '{"status":"runtime-error"}') = v_finished,
    'duplicate finish cannot replace first result');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('owner_c','run',30,300,90000)$q$, 'MC429');
  PERFORM pg_temp.assert_true(public.mc_get_job('owner_b', (v_next ->> 'id')::uuid) ->> 'status' = 'running',
    'duplicate old completion cannot free newer capacity');
  PERFORM public.mc_finish_job((v_next ->> 'id')::uuid, '{"status":"runtime-error"}');
END;
$$;

-- Invalid arguments are definitive rejections and never reserve units.
DO $$
BEGIN
  PERFORM pg_temp.reset_execution();
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job(NULL,'run',30,300,90000)$q$, 'MC400');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('','run',30,300,90000)$q$, 'MC400');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('bad invite','run',30,300,90000)$q$, 'MC400');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job(repeat('a',65),'run',30,300,90000)$q$, 'MC400');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('a','retry',30,300,90000)$q$, 'MC400');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('a',NULL,30,300,90000)$q$, 'MC400');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('a','run',0,300,90000)$q$, 'MC400');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('a','run',30,-1,90000)$q$, 'MC400');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('a','run',30,300,NULL)$q$, 'MC400');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_get_job('a',NULL)$q$, 'MC400');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_finish_job(NULL,'{}')$q$, 'MC400');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM execution.jobs) = 0, 'invalid admission stores no job');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM execution.counters) = 0, 'invalid admission stores no counters');
END;
$$;

-- Invite and global budgets count jobs; monthly and rolling budgets count 1/9
-- pessimistically reserved provider units. Equality at every limit is permitted.
DO $$
DECLARE v_job jsonb; v_before bigint; v_i integer;
BEGIN
  PERFORM pg_temp.reset_execution();
  FOR v_i IN 1..2 LOOP
    v_job := public.mc_admit_job('a', 'run', 2, 20, 100);
    PERFORM public.mc_finish_job((v_job ->> 'id')::uuid, '{"status":"compile-error"}');
  END LOOP;
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('a','run',2,20,100)$q$, 'MC429');
  v_job := public.mc_admit_job('b', 'run', 2, 20, 100);
  PERFORM pg_temp.assert_true(v_job ->> 'status' = 'running', 'invite budget does not charge other owners');
  PERFORM public.mc_finish_job((v_job ->> 'id')::uuid, '{"status":"compile-error"}');

  PERFORM pg_temp.reset_execution();
  v_job := public.mc_admit_job('a', 'run', 30, 2, 100);
  PERFORM public.mc_finish_job((v_job ->> 'id')::uuid, '{"status":"compile-error"}');
  v_job := public.mc_admit_job('b', 'run', 30, 2, 100);
  PERFORM public.mc_finish_job((v_job ->> 'id')::uuid, '{"status":"compile-error"}');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('c','run',30,2,100)$q$, 'MC429');

  PERFORM pg_temp.reset_execution();
  v_job := public.mc_admit_job('a', 'submit', 1, 1, 9);
  PERFORM pg_temp.assert_true((SELECT count FROM execution.counters WHERE scope = 'month') = 9,
    'submit reserves nine units at monthly equality');
  PERFORM pg_temp.assert_true((SELECT count FROM execution.counters WHERE scope = 'invite-day') = 1,
    'submit counts as only one invite job');
  PERFORM pg_temp.assert_true((SELECT count FROM execution.counters WHERE scope = 'global-day') = 1,
    'submit counts as only one global job');
  PERFORM public.mc_finish_job((v_job ->> 'id')::uuid, '{"status":"compile-error"}');
  SELECT sum(count) INTO v_before FROM execution.counters;
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('b','run',30,300,9)$q$, 'MC429');
  PERFORM pg_temp.assert_true((SELECT sum(count) FROM execution.counters) = v_before,
    'monthly rejection and early compilation failure do not refund or charge again');

  PERFORM pg_temp.reset_execution();
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('a','submit',30,300,8)$q$, 'MC429');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM execution.counters) = 0, 'oversized submit reserves nothing');
  v_job := public.mc_admit_job('a', 'run', 30, 300, 1);
  PERFORM public.mc_finish_job((v_job ->> 'id')::uuid, '{"status":"compile-error"}');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('a','run',30,300,1)$q$, 'MC429');
END;
$$;

-- Rolling minute: 29+1 is allowed; 30+1 and 29+9 are not. A reservation at
-- or before the 60-second cutoff is excluded, not a fixed calendar-minute bucket.
DO $$
DECLARE v_job jsonb; v_now timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_temp.reset_execution();
  INSERT INTO execution.minute_reservations VALUES
    (v_now,9),(v_now,9),(v_now,9),(v_now,1),(v_now,1);
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('a','submit',30,300,90000)$q$, 'MC429');
  v_job := public.mc_admit_job('a', 'run', 30, 300, 90000);
  PERFORM public.mc_finish_job((v_job ->> 'id')::uuid, '{"status":"compile-error"}');
  PERFORM pg_temp.assert_true((SELECT sum(cost) FROM execution.minute_reservations) = 30,
    'rolling equality accepts exactly thirty units');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('b','run',30,300,90000)$q$, 'MC429');
  UPDATE execution.minute_reservations SET created_at = clock_timestamp() - interval '61 seconds';
  v_job := public.mc_admit_job('b', 'submit', 30, 300, 90000);
  PERFORM pg_temp.assert_true((SELECT sum(cost) FROM execution.minute_reservations) = 9, 'expired rolling charges are pruned');
  PERFORM public.mc_finish_job((v_job ->> 'id')::uuid, '{"status":"compile-error"}');

  PERFORM pg_temp.reset_execution();
  v_now := clock_timestamp() - interval '60 seconds';
  INSERT INTO execution.minute_reservations VALUES (v_now,9),(v_now,9),(v_now,9),(v_now,1),(v_now,1),(v_now,1);
  v_job := public.mc_admit_job('boundary', 'run', 30, 300, 90000);
  PERFORM pg_temp.assert_true((SELECT sum(cost) FROM execution.minute_reservations) = 1,
    'the exact rolling lower bound is excluded');
END;
$$;

-- Lease expiry, lease-anchored quarantine, stale finish fencing, and recovery
-- through either GET or admission. Administrative clock fixtures require no sleep.
DO $$
DECLARE
  v_job jsonb; v_next jsonb; v_recovered jsonb; v_id uuid;
  v_deadline timestamptz; v_before bigint;
BEGIN
  PERFORM pg_temp.reset_execution();
  v_job := public.mc_admit_job('a', 'submit', 30, 300, 90000);
  v_id := (v_job ->> 'id')::uuid;
  SELECT sum(count) INTO v_before FROM execution.counters;
  UPDATE execution.jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = v_id;
  UPDATE execution.capacity SET occupied_until = (SELECT lease_expires_at + interval '120 seconds'
    FROM execution.jobs WHERE id = v_id) WHERE singleton;
  SELECT occupied_until INTO v_deadline FROM execution.capacity;
  v_recovered := public.mc_get_job('a', v_id);
  PERFORM pg_temp.assert_true(v_recovered ->> 'status' = 'completed'
    AND v_recovered -> 'result' = execution.unavailable_result(), 'expired lease becomes canonical unavailable');
  PERFORM pg_temp.assert_true((SELECT occupied_until FROM execution.capacity) = v_deadline,
    'reading expiry does not restart the quarantine clock');
  PERFORM pg_temp.assert_true(public.mc_finish_job(v_id, '{"status":"compile-error"}') = v_recovered,
    'late finish cannot replace expired result');
  PERFORM pg_temp.assert_true((SELECT sum(count) FROM execution.counters) = v_before, 'expiry never refunds quota');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('b','run',30,300,90000)$q$, 'MC429');
  UPDATE execution.capacity SET occupied_until = clock_timestamp() - interval '1 second' WHERE singleton;
  v_next := public.mc_admit_job('b', 'run', 30, 300, 90000);
  PERFORM pg_temp.assert_true(public.mc_finish_job(v_id, '{"status":"runtime-error"}') = v_recovered,
    'old completion remains fenced after next admission');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('c','run',30,300,90000)$q$, 'MC429');
  PERFORM pg_temp.assert_true(public.mc_get_job('b', (v_next ->> 'id')::uuid) ->> 'status' = 'running',
    'old finish cannot release new job');

  PERFORM pg_temp.reset_execution();
  v_job := public.mc_admit_job('a', 'run', 30, 300, 90000);
  v_id := (v_job ->> 'id')::uuid;
  UPDATE execution.jobs SET lease_expires_at = clock_timestamp() - interval '121 seconds' WHERE id = v_id;
  UPDATE execution.capacity SET occupied_until = clock_timestamp() - interval '1 second' WHERE singleton;
  v_next := public.mc_admit_job('b', 'run', 30, 300, 90000);
  PERFORM pg_temp.assert_true(public.mc_get_job('a', v_id) -> 'result' = execution.unavailable_result(),
    'admission reaps expired job after entire uncertainty window');

  PERFORM pg_temp.reset_execution();
  v_job := public.mc_admit_job('a', 'run', 30, 300, 90000);
  v_id := (v_job ->> 'id')::uuid;
  UPDATE execution.jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = v_id;
  v_recovered := public.mc_finish_job(v_id, '{"status":"compile-error"}');
  PERFORM pg_temp.assert_true(v_recovered -> 'result' = execution.unavailable_result(),
    'finish itself fences expiry without a preceding GET');

  PERFORM pg_temp.reset_execution();
  v_job := public.mc_admit_job('a', 'run', 30, 300, 90000);
  v_id := (v_job ->> 'id')::uuid;
  SELECT occupied_until INTO v_deadline FROM execution.capacity;
  v_recovered := public.mc_finish_job(v_id, '{"status":"service-error","message":"SECRET"}');
  PERFORM pg_temp.assert_true(v_recovered -> 'result' = execution.unavailable_result(), 'service failure has only fixed safe result');
  PERFORM pg_temp.assert_true((SELECT occupied_until FROM execution.capacity) = v_deadline,
    'ambiguous failure retains the complete reserved uncertainty window');
  PERFORM pg_temp.assert_true(public.mc_finish_job(v_id, '{"status":"compile-error"}') = v_recovered,
    'duplicate cannot turn service failure into a capacity-releasing result');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('b','run',30,300,90000)$q$, 'MC429');
END;
$$;

-- Creation-based 24h retention is applied by GET, finish and admission. Counter
-- retention follows UTC periods rather than job retention and never refunds.
DO $$
DECLARE v_job jsonb; v_id uuid; v_before bigint; v_day date; v_month date;
BEGIN
  PERFORM pg_temp.reset_execution();
  v_job := public.mc_admit_job('a', 'run', 30, 300, 90000);
  v_id := (v_job ->> 'id')::uuid;
  PERFORM public.mc_finish_job(v_id, '{"status":"compile-error"}');
  SELECT sum(count) INTO v_before FROM execution.counters;
  UPDATE execution.jobs SET created_at = clock_timestamp() - interval '23 hours 59 minutes' WHERE id = v_id;
  PERFORM pg_temp.assert_true(public.mc_get_job('a', v_id) IS NOT NULL, 'result exists before 24h retention boundary');
  UPDATE execution.jobs SET created_at = clock_timestamp() - interval '24 hours' WHERE id = v_id;
  PERFORM pg_temp.assert_true(public.mc_get_job('a', v_id) IS NULL, 'GET expires a result at 24h');
  PERFORM pg_temp.assert_true(public.mc_finish_job(v_id, '{"status":"runtime-error"}') IS NULL,
    'finish never resurrects an expired result');
  PERFORM pg_temp.assert_true((SELECT sum(count) FROM execution.counters) = v_before, 'retention does not refund current counters');

  v_job := public.mc_admit_job('a', 'run', 30, 300, 90000);
  v_id := (v_job ->> 'id')::uuid;
  PERFORM public.mc_finish_job(v_id, '{"status":"compile-error"}');
  UPDATE execution.jobs SET created_at = clock_timestamp() - interval '25 hours' WHERE id = v_id;
  PERFORM pg_temp.assert_true(public.mc_finish_job(v_id, '{"status":"runtime-error"}') IS NULL,
    'finish prunes expired duplicate without a GET');

  v_job := public.mc_admit_job('a', 'run', 30, 300, 90000);
  v_id := (v_job ->> 'id')::uuid;
  PERFORM public.mc_finish_job(v_id, '{"status":"compile-error"}');
  UPDATE execution.jobs SET created_at = clock_timestamp() - interval '25 hours' WHERE id = v_id;
  v_job := public.mc_admit_job('b', 'run', 30, 300, 90000);
  PERFORM pg_temp.assert_true((SELECT count(*) FROM execution.jobs WHERE id = v_id) = 0, 'admission prunes expired results');
  PERFORM public.mc_finish_job((v_job ->> 'id')::uuid, '{"status":"compile-error"}');
  PERFORM pg_temp.assert_true(public.mc_finish_job('00000000-0000-4000-8000-000000000000', '{}') IS NULL,
    'unknown finish is null, not a new job');

  v_day := (clock_timestamp() AT TIME ZONE 'UTC')::date;
  v_month := date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')::date;
  INSERT INTO execution.counters VALUES
    ('invite-day','old',v_day - 1,300), ('global-day','all',v_day - 1,300),
    ('month','all',(v_month - interval '1 month')::date,90000);
  PERFORM public.mc_get_job('a', '00000000-0000-4000-8000-000000000000');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM execution.counters WHERE period = v_day AND scope <> 'month') > 0,
    'current UTC day counters persist');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM execution.counters WHERE period = v_month AND scope = 'month') = 1,
    'current UTC month counter persists');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM execution.counters
    WHERE (scope <> 'month' AND period < v_day) OR (scope = 'month' AND period < v_month)) = 0,
    'only prior UTC periods are pruned');
END;
$$;

-- Exact durable whitelist: do not merely search SQL text or marker strings.
-- Returned and stored JSON must equal the complete expected safe object.
DO $$
DECLARE
  v_unavailable jsonb := '{"status":"service-error","message":"Execution unavailable. This job will not be retried; reserved quota is not refunded.","implementationComplexityVerified":false}';
  v_generic jsonb := '{"status":"wrong-answer","message":"The returned output did not match the required answer format or value.","implementationComplexityVerified":false}';
  v_public_pass jsonb := '{"status":"passed","implementationComplexityVerified":false,"feedback":{"status":"passed","cases":[{"index":0,"expected":1,"actual":1,"passed":true},{"index":1,"expected":2,"actual":2,"passed":true},{"index":2,"expected":0,"actual":0,"passed":true}]}}';
  v_input jsonb; v_status text;
BEGIN
  v_input := '{"status":"passed","source":"SECRET","token":"SECRET","message":"SECRET","diagnostics":"SECRET","implementationComplexityVerified":true,"feedback":{"status":"passed","input":"SECRET","cases":[{"index":99,"expected":99,"actual":1,"passed":false,"input":"SECRET","diagnostic":"SECRET"},{"actual":2,"source":"SECRET"},{"actual":0,"token":"SECRET"}]}}';
  PERFORM pg_temp.check_result(v_input, v_public_pass);
  PERFORM pg_temp.check_result(
    '{"status":"wrong-answer","feedback":{"status":"wrong-answer","cases":[{"actual":"SOURCE","expected":"SECRET"},{"actual":true,"input":"SECRET"},{"actual":0}]}}',
    '{"status":"wrong-answer","implementationComplexityVerified":false,"feedback":{"status":"wrong-answer","cases":[{"index":0,"expected":1,"actual":null,"passed":false},{"index":1,"expected":2,"actual":true,"passed":false},{"index":2,"expected":0,"actual":0,"passed":true}]}}');
  PERFORM pg_temp.check_result(
    '{"status":"wrong-answer","feedback":{"status":"wrong-answer","cases":[{"actual":1.5},{"actual":1e1000},{"actual":{"source":"SECRET"}}]}}',
    '{"status":"wrong-answer","implementationComplexityVerified":false,"feedback":{"status":"wrong-answer","cases":[{"index":0,"expected":1,"actual":1.5,"passed":false},{"index":1,"expected":2,"actual":null,"passed":false},{"index":2,"expected":0,"actual":null,"passed":false}]}}');
  PERFORM pg_temp.check_result('{"status":"wrong-answer","feedback":{"status":"wrong-answer","cases":[{}, {}, {}]}}',
    '{"status":"wrong-answer","implementationComplexityVerified":false,"feedback":{"status":"wrong-answer","cases":[{"index":0,"expected":1,"actual":null,"passed":false},{"index":1,"expected":2,"actual":null,"passed":false},{"index":2,"expected":0,"actual":null,"passed":false}]}}');
  PERFORM pg_temp.check_result('{"status":"wrong-answer","message":"SOURCE","diagnostic":"SECRET"}', v_generic);
  PERFORM pg_temp.check_result('{"status":"wrong-answer","feedback":null,"message":"SOURCE"}', v_generic);
  FOREACH v_status IN ARRAY ARRAY['compile-error','runtime-error','resource-limit'] LOOP
    PERFORM pg_temp.check_result(jsonb_build_object('status',v_status,'message','SOURCE','code','SECRET','diagnostics','SECRET'),
      jsonb_build_object('status',v_status,'implementationComplexityVerified',false));
    PERFORM pg_temp.check_result(jsonb_build_object('status',v_status,'feedback',jsonb_build_object(
      'status','wrong-answer','failureCategories',jsonb_build_array('integer extremes'),'input','SECRET'),'message','PRIVATE'),
      jsonb_build_object('status',v_status,'implementationComplexityVerified',false,'feedback',jsonb_build_object(
      'status','wrong-answer','failureCategories',jsonb_build_array('integer extremes'))));
  END LOOP;
  PERFORM pg_temp.check_result(
    '{"status":"wrong-answer","feedback":{"status":"wrong-answer","failureCategories":["empty input","single-element boundaries","upper boundary","duplicate handling","insertion between values","lower boundary","integer extremes","large input boundary","empty input"],"cases":[{"input":"SECRET"}],"source":"SECRET"},"message":"SECRET"}',
    '{"status":"wrong-answer","implementationComplexityVerified":false,"feedback":{"status":"wrong-answer","failureCategories":["empty input","single-element boundaries","upper boundary","duplicate handling","insertion between values","lower boundary","integer extremes","large input boundary"]}}');
  PERFORM pg_temp.check_result('{"status":"passed","feedback":{"status":"passed","failureCategories":[],"source":"SECRET"}}',
    '{"status":"passed","implementationComplexityVerified":false,"feedback":{"status":"passed","failureCategories":[]}}');
  FOREACH v_input IN ARRAY ARRAY[
    'null'::jsonb, '[]'::jsonb, '"SOURCE"'::jsonb, '{}'::jsonb,
    '{"status":"SOURCE"}'::jsonb,
    '{"status":"service-error","message":"SOURCE","source":"SECRET"}'::jsonb,
    '{"status":"passed"}'::jsonb,
    '{"status":"passed","feedback":{"status":"wrong-answer","failureCategories":[]}}'::jsonb,
    '{"status":"passed","feedback":{"status":"passed","failureCategories":["empty input"]}}'::jsonb,
    '{"status":"wrong-answer","feedback":{"status":"wrong-answer","failureCategories":[]}}'::jsonb,
    '{"status":"wrong-answer","feedback":{"status":"wrong-answer","failureCategories":["SOURCE"]}}'::jsonb,
    '{"status":"wrong-answer","feedback":{"status":"wrong-answer","failureCategories":[null]}}'::jsonb,
    '{"status":"wrong-answer","feedback":{"status":"wrong-answer","failureCategories":"empty input"}}'::jsonb,
    '{"status":"passed","feedback":{"status":"passed","cases":[{"actual":0},{"actual":2},{"actual":0}]}}'::jsonb,
    '{"status":"wrong-answer","feedback":{"status":"wrong-answer","cases":[{"actual":1},{"actual":2},{"actual":0}]}}'::jsonb,
    '{"status":"wrong-answer","feedback":{"status":"wrong-answer","cases":[{},{}]}}'::jsonb,
    '{"status":"compile-error","feedback":{"status":"wrong-answer","cases":[{},{},{}]}}'::jsonb,
    '{"status":"compile-error","feedback":null}'::jsonb
  ] LOOP
    PERFORM pg_temp.check_result(v_input, v_unavailable);
  END LOOP;
  PERFORM pg_temp.check_result(NULL, v_unavailable);
END;
$$;

-- One-shot cutover preserves real provider usage without re-executing unfinished
-- work. Only scalar metadata and sanitized results survive; import is atomic.
DO $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_ms bigint;
  v_day text;
  v_month text;
  v_snapshot jsonb;
  v_empty jsonb := '{"version":1,"jobs":[],"counters":[],"minute_reservations":[],"occupied_until":0}';
  v_job jsonb;
  v_finished_id uuid := '00000000-0000-4000-8000-000000000011';
  v_pending_id uuid := '00000000-0000-4000-8000-000000000012';
  v_expired_id uuid := '00000000-0000-4000-8000-000000000013';
BEGIN
  PERFORM pg_temp.reset_execution();
  v_ms := trunc(extract(epoch FROM v_now) * 1000)::bigint;
  v_day := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD');
  v_month := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM');
  v_snapshot := jsonb_build_object(
    'version', 1,
    'jobs', jsonb_build_array(
      jsonb_build_object('id',v_finished_id,'invite_id','legacy','state','finished','created_at',v_ms - 20000,
        'result','{"status":"compile-error","message":"SOURCE","token":"SECRET"}'::jsonb),
      jsonb_build_object('id',v_pending_id,'invite_id','legacy','state','running','created_at',v_ms - 10000,'result',NULL),
      jsonb_build_object('id',v_expired_id,'invite_id','legacy','state','finished','created_at',v_ms - 90000000,
        'result','{"status":"compile-error"}'::jsonb)),
    'counters', jsonb_build_array(
      jsonb_build_object('scope','invite-day','subject','legacy','period',v_day,'count',2),
      jsonb_build_object('scope','global-day','subject','all','period',v_day,'count',2),
      jsonb_build_object('scope','month','subject','all','period',v_month,'count',28),
      jsonb_build_object('scope','global-day','subject','all','period',
        to_char((v_now AT TIME ZONE 'UTC')::date - 1, 'YYYY-MM-DD'),'count',300),
      jsonb_build_object('scope','month','subject','all','period',
        to_char((v_now AT TIME ZONE 'UTC') - interval '1 month', 'YYYY-MM'),'count',90000)),
    'minute_reservations', jsonb_build_array(
      jsonb_build_object('created_at',v_ms - 1000,'cost',9),
      jsonb_build_object('created_at',v_ms - 2000,'cost',9),
      jsonb_build_object('created_at',v_ms - 3000,'cost',9),
      jsonb_build_object('created_at',v_ms - 61000,'cost',1)),
    'occupied_until', v_ms + 60000);
  PERFORM pg_temp.assert_true(public.mc_import_legacy(v_snapshot) = '{"imported":true}', 'import completes atomically');
  PERFORM pg_temp.assert_true(public.mc_get_job('legacy',v_finished_id) -> 'result' =
    '{"status":"compile-error","implementationComplexityVerified":false}', 'import strips legacy durable diagnostics');
  PERFORM pg_temp.assert_true(public.mc_get_job('legacy',v_pending_id) -> 'result' = execution.unavailable_result(),
    'import recovers unfinished original ID as unavailable without retry');
  PERFORM pg_temp.assert_true(public.mc_get_job('other',v_pending_id) IS NULL, 'import preserves invite ownership');
  PERFORM pg_temp.assert_true(public.mc_get_job('legacy',v_expired_id) IS NULL, 'import omits expired result');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM execution.jobs) = 2, 'only retained source-free legacy jobs are stored');
  PERFORM pg_temp.assert_true((SELECT count FROM execution.counters WHERE scope = 'month') = 28,
    'import preserves current monthly provider usage');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM execution.counters) = 3, 'import drops prior UTC counter periods');
  PERFORM pg_temp.assert_true((SELECT sum(cost) FROM execution.minute_reservations) = 27,
    'import preserves only rolling-minute reservations');
  PERFORM pg_temp.assert_true((SELECT occupied_until > v_now + interval '119 seconds' FROM execution.capacity),
    'unfinished cutover reserves a conservative import-time quarantine');
  PERFORM pg_temp.expect_state(format('SELECT public.mc_import_legacy(%L::jsonb)',v_snapshot::text), 'MC400');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('other','run',30,300,90000)$q$, 'MC429');
  UPDATE execution.capacity SET occupied_until = clock_timestamp() - interval '1 second' WHERE singleton;
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('legacy','run',2,300,90000)$q$, 'MC429');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('other','run',30,2,90000)$q$, 'MC429');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('other','run',30,300,28)$q$, 'MC429');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('other','submit',30,300,90000)$q$, 'MC429');
  v_job := public.mc_admit_job('other','run',30,300,90000);
  PERFORM pg_temp.assert_true(v_job ->> 'status' = 'running', 'fresh work proceeds only within all preserved budgets');

  PERFORM pg_temp.reset_execution();
  PERFORM pg_temp.assert_true(public.mc_import_legacy(v_empty) = '{"imported":true}', 'empty import is valid once');
  PERFORM pg_temp.expect_state(format('SELECT public.mc_import_legacy(%L::jsonb)',v_empty::text), 'MC400');
  PERFORM pg_temp.assert_true((SELECT legacy_imported FROM execution.capacity), 'empty import cannot be replayed');

  PERFORM pg_temp.reset_execution();
  v_job := public.mc_admit_job('existing','run',30,300,90000);
  PERFORM pg_temp.expect_state(format('SELECT public.mc_import_legacy(%L::jsonb)',v_empty::text), 'MC400');
  PERFORM pg_temp.assert_true(public.mc_get_job('existing',(v_job ->> 'id')::uuid) = v_job,
    'nonempty destination is never overwritten');

  PERFORM pg_temp.reset_execution();
  v_snapshot := jsonb_set(v_snapshot, '{counters}', jsonb_build_array(
    jsonb_build_object('scope','month','subject','all','period',v_month,'count',-1)));
  PERFORM pg_temp.expect_state(format('SELECT public.mc_import_legacy(%L::jsonb)',v_snapshot::text), 'MC400');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM execution.jobs) = 0
    AND (SELECT count(*) FROM execution.counters) = 0
    AND NOT (SELECT legacy_imported FROM execution.capacity),
    'invalid counter rolls back preceding imported jobs and marker');
  PERFORM pg_temp.expect_state(format('SELECT public.mc_import_legacy(%L::jsonb)',
    (v_empty || '{"source":"SECRET"}'::jsonb)::text), 'MC400');

  PERFORM pg_temp.reset_execution();
  v_snapshot := jsonb_set(v_empty, '{occupied_until}', to_jsonb(v_ms + 60000));
  PERFORM public.mc_import_legacy(v_snapshot);
  PERFORM pg_temp.assert_true((SELECT occupied_until FROM execution.capacity) =
    execution.epoch_milliseconds(to_jsonb(v_ms + 60000)), 'completed-only cutover preserves existing quarantine exactly');
  PERFORM pg_temp.expect_state($q$SELECT public.mc_admit_job('other','run',30,300,90000)$q$, 'MC429');
END;
$$;

-- Real privilege checks under the API roles, not catalog/source-text matching.
-- Helpers are invoker functions; they must not confer table/RPC access.
CREATE FUNCTION pg_temp.check_denied_role(p_role text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_sql text; v_denied boolean;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  FOREACH v_sql IN ARRAY ARRAY[
    $q$SELECT public.mc_admit_job('a','run',30,300,90000)$q$,
    $q$SELECT public.mc_get_job('a','00000000-0000-4000-8000-000000000000')$q$,
    $q$SELECT public.mc_finish_job('00000000-0000-4000-8000-000000000000','{}')$q$,
    $q$SELECT public.mc_import_legacy('{}')$q$,
    'SELECT * FROM execution.jobs',
    'SELECT * FROM execution.capacity',
    'SELECT * FROM execution.counters',
    'SELECT * FROM execution.minute_reservations',
    'SELECT execution.unavailable_result()',
    $q$SELECT execution.sanitize_result('{}')$q$
  ] LOOP
    v_denied := false;
    BEGIN
      EXECUTE v_sql;
    EXCEPTION WHEN insufficient_privilege THEN
      v_denied := true;
    END;
    IF NOT v_denied THEN RAISE EXCEPTION 'Role % unexpectedly accessed %', p_role, v_sql; END IF;
  END LOOP;
  RESET ROLE;
END;
$$;
SELECT pg_temp.reset_execution();
SELECT pg_temp.check_denied_role('anon');
SELECT pg_temp.check_denied_role('authenticated');
SET LOCAL ROLE service_role;
DO $$
DECLARE v_job jsonb; v_finished jsonb; v_sql text; v_denied boolean;
BEGIN
  -- A hostile caller search_path cannot redirect SECURITY DEFINER lookups.
  PERFORM set_config('search_path', 'pg_temp, public', true);
  IF public.mc_import_legacy('{"version":1,"jobs":[],"counters":[],"minute_reservations":[],"occupied_until":0}')
      IS DISTINCT FROM '{"imported":true}'::jsonb THEN
    RAISE EXCEPTION 'service role cannot perform cutover import';
  END IF;
  v_job := public.mc_admit_job('service', 'run', 30, 300, 90000);
  IF v_job ->> 'status' IS DISTINCT FROM 'running' THEN RAISE EXCEPTION 'service role cannot admit'; END IF;
  IF public.mc_get_job('service', (v_job ->> 'id')::uuid) IS DISTINCT FROM v_job THEN
    RAISE EXCEPTION 'service role cannot get its admitted job';
  END IF;
  v_finished := public.mc_finish_job((v_job ->> 'id')::uuid, '{"status":"compile-error","source":"SECRET"}');
  IF v_finished -> 'result' IS DISTINCT FROM '{"status":"compile-error","implementationComplexityVerified":false}'::jsonb THEN
    RAISE EXCEPTION 'service role cannot finish safely';
  END IF;
  FOREACH v_sql IN ARRAY ARRAY[
    'SELECT * FROM execution.jobs', 'SELECT * FROM execution.capacity',
    'SELECT * FROM execution.counters', 'SELECT * FROM execution.minute_reservations',
    'SELECT execution.unavailable_result()'
  ] LOOP
    v_denied := false;
    BEGIN EXECUTE v_sql; EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
    IF NOT v_denied THEN RAISE EXCEPTION 'service role has direct private access: %', v_sql; END IF;
  END LOOP;
END;
$$;
RESET ROLE;

ROLLBACK;
\echo 'execution SQL invariants passed (all fixtures rolled back)'
