-- ============================================
-- PRESHOOT — SECURITY DEFINER + SEARCH_PATH HARDENING
-- Idempotent. No DELETE/TRUNCATE/DROP TABLE.
-- Does not rotate credentials or modify Storage objects.
--
-- OPERATOR: paste this file LAST after any older supabase_*.sql paste.
--
-- Intent:
-- 1. Backend/admin RPCs: service_role only (anon/authenticated cannot EXECUTE).
-- 2. RLS helpers: private schema (not PostgREST Data API), still usable by policies.
-- 3. Fix workspace_members TTL SELECT leak (recent members visible to any authenticated user).
-- 4. Pin search_path on remaining public helpers/triggers.
-- 5. Stop default EXECUTE grants to anon/authenticated on future public functions.
-- 6. Pin Auth hook bodies (search_path=''; no require_service_role on hooks).
-- ============================================

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO postgres, service_role, authenticated;

-- ── Internal guard for backend RPCs ────────────────────────

CREATE OR REPLACE FUNCTION private.require_service_role()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.require_service_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.require_service_role() TO postgres, service_role;

-- ── RLS helpers (not exposed via /rest/v1/rpc) ─────────────

CREATE OR REPLACE FUNCTION private.is_workspace_member(p_workspace_id uuid, p_user_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_workspace_id IS NULL OR p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN false;
  END IF;
  -- RLS always passes auth.uid(). Block membership-oracle probes for other user ids.
  IF coalesce(auth.role(), '') = 'authenticated'
     AND p_user_id IS DISTINCT FROM auth.uid()::text THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.workspace_members m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = p_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.can_edit_workspace(p_workspace_id uuid, p_user_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_workspace_id IS NULL OR p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN false;
  END IF;
  IF coalesce(auth.role(), '') = 'authenticated'
     AND p_user_id IS DISTINCT FROM auth.uid()::text THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.workspace_members m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = p_user_id
      AND m.role IN ('owner', 'editor')
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.workspace_role(p_workspace_id uuid, p_user_id text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
BEGIN
  IF p_workspace_id IS NULL OR p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN NULL;
  END IF;
  IF coalesce(auth.role(), '') = 'authenticated'
     AND p_user_id IS DISTINCT FROM auth.uid()::text THEN
    RETURN NULL;
  END IF;
  SELECT m.role INTO v_role
  FROM public.workspace_members m
  WHERE m.workspace_id = p_workspace_id
    AND m.user_id = p_user_id
  LIMIT 1;
  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION private.workspace_id_from_realtime_topic()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  t text;
  part text;
BEGIN
  t := realtime.topic();
  IF t IS NULL OR t NOT LIKE 'workspace:%' THEN
    RETURN NULL;
  END IF;
  part := split_part(t, ':', 2);
  IF part !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN part::uuid;
END;
$$;

REVOKE ALL ON FUNCTION private.is_workspace_member(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_edit_workspace(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.workspace_role(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.workspace_id_from_realtime_topic() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.is_workspace_member(uuid, text) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION private.can_edit_workspace(uuid, text) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION private.workspace_role(uuid, text) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION private.workspace_id_from_realtime_topic() TO authenticated, service_role, postgres;

COMMENT ON FUNCTION private.is_workspace_member(uuid, text) IS
  'RLS helper. SECURITY DEFINER to avoid workspace_members recursion. Not in the Data API schema.';
COMMENT ON FUNCTION private.workspace_id_from_realtime_topic() IS
  'Realtime RLS helper. Maps workspace:{uuid} topics. Not in the Data API schema.';

-- ── Point policies at private helpers BEFORE dropping public RPCs ──

DROP POLICY IF EXISTS workspaces_select_member ON public.workspaces;
CREATE POLICY workspaces_select_member ON public.workspaces
  FOR SELECT TO authenticated
  USING (private.is_workspace_member(id, auth.uid()::text));

DROP POLICY IF EXISTS workspace_data_select_member ON public.workspace_data;
CREATE POLICY workspace_data_select_member ON public.workspace_data
  FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()::text));

DROP POLICY IF EXISTS workspace_members_select_member ON public.workspace_members;
DROP POLICY IF EXISTS "Policy to implement Time To Live (TTL)" ON public.workspace_members;
CREATE POLICY workspace_members_select_member ON public.workspace_members
  FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()::text));

DROP POLICY IF EXISTS workspace_document_versions_select_member ON public.workspace_document_versions;
CREATE POLICY workspace_document_versions_select_member ON public.workspace_document_versions
  FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()::text));

DROP POLICY IF EXISTS workspace_realtime_broadcast_select ON realtime.messages;
CREATE POLICY workspace_realtime_broadcast_select
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  extension = 'broadcast'
  AND private.workspace_id_from_realtime_topic() IS NOT NULL
  AND private.is_workspace_member(
    private.workspace_id_from_realtime_topic(),
    (SELECT auth.uid()::text)
  )
);

DROP POLICY IF EXISTS workspace_realtime_presence_select ON realtime.messages;
CREATE POLICY workspace_realtime_presence_select
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  extension = 'presence'
  AND private.workspace_id_from_realtime_topic() IS NOT NULL
  AND private.is_workspace_member(
    private.workspace_id_from_realtime_topic(),
    (SELECT auth.uid()::text)
  )
);

DROP POLICY IF EXISTS workspace_realtime_presence_insert ON realtime.messages;
CREATE POLICY workspace_realtime_presence_insert
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  extension = 'presence'
  AND private.workspace_id_from_realtime_topic() IS NOT NULL
  AND private.is_workspace_member(
    private.workspace_id_from_realtime_topic(),
    (SELECT auth.uid()::text)
  )
);

-- ── Remove public Data API RPCs for helpers ────────────────

DROP FUNCTION IF EXISTS public.is_workspace_member(uuid, text);
DROP FUNCTION IF EXISTS public.can_edit_workspace(uuid, text);
DROP FUNCTION IF EXISTS public.workspace_role(uuid, text);
DROP FUNCTION IF EXISTS public.workspace_id_from_realtime_topic();

-- ── Timezone / trigger search_path ─────────────────────────

CREATE OR REPLACE FUNCTION public.preshoot_sanitize_tz(p_tz text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_tz text;
BEGIN
  v_tz := coalesce(nullif(trim(both FROM coalesce(p_tz, '')), ''), 'UTC');
  IF v_tz !~ '^[A-Za-z0-9_+\-/]{1,64}$' THEN
    RETURN 'UTC';
  END IF;
  BEGIN
    PERFORM pg_catalog.timezone(v_tz, pg_catalog.now());
    RETURN v_tz;
  EXCEPTION WHEN others THEN
    RETURN 'UTC';
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.preshoot_local_date(p_tz text)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_tz text;
BEGIN
  v_tz := public.preshoot_sanitize_tz(p_tz);
  BEGIN
    RETURN (pg_catalog.timezone(v_tz, pg_catalog.now()))::date;
  EXCEPTION WHEN others THEN
    RETURN (pg_catalog.timezone('UTC', pg_catalog.now()))::date;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.preshoot_sanitize_tz(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preshoot_local_date(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preshoot_sanitize_tz(text) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.preshoot_local_date(text) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.update_updated_at() TO service_role, postgres;

-- ── Event-trigger helper: not a client RPC ─────────────────

REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO postgres;

-- ── Backend / admin SECURITY DEFINER RPCs ──────────────────

CREATE OR REPLACE FUNCTION public.admin_daily_usage(p_since timestamptz DEFAULT NULL)
RETURNS TABLE(
  day date,
  scans bigint,
  ai_requests bigint,
  active_users bigint,
  cost_sum numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.require_service_role();
  RETURN QUERY
  SELECT
    (ue.created_at AT TIME ZONE 'utc')::date,
    count(*) FILTER (WHERE ue.event_type = 'scan')::bigint,
    count(*)::bigint,
    count(DISTINCT ue.user_id)::bigint,
    coalesce(sum(ue.estimated_cost), 0)
  FROM public.usage_events ue
  WHERE ue.status = 'success'
    AND (p_since IS NULL OR ue.created_at >= p_since)
  GROUP BY 1
  ORDER BY 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_usage_rollup(p_since timestamptz DEFAULT NULL)
RETURNS TABLE(
  user_id text,
  event_type text,
  provider text,
  model text,
  event_count bigint,
  cost_sum numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.require_service_role();
  RETURN QUERY
  SELECT
    ue.user_id,
    ue.event_type,
    ue.provider,
    ue.model,
    count(*)::bigint,
    coalesce(sum(ue.estimated_cost), 0)
  FROM public.usage_events ue
  WHERE ue.status = 'success'
    AND (p_since IS NULL OR ue.created_at >= p_since)
  GROUP BY 1, 2, 3, 4;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_usage_daily(
  p_user_id text,
  p_field text,
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_day date := (pg_catalog.timezone('utc', pg_catalog.now()))::date;
  v_row public.usage_daily%ROWTYPE;
  v_count integer;
BEGIN
  PERFORM private.require_service_role();
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_user');
  END IF;
  IF p_field IS NULL OR p_field NOT IN ('scans', 'director_msgs', 'research_calls') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_field');
  END IF;
  IF p_limit IS NULL OR p_limit < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_limit');
  END IF;

  INSERT INTO public.usage_daily AS u (
    user_id, day, scans, director_msgs, research_calls, updated_at
  ) VALUES (
    p_user_id,
    v_day,
    CASE WHEN p_field = 'scans' THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'director_msgs' THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'research_calls' THEN 1 ELSE 0 END,
    pg_catalog.now()
  )
  ON CONFLICT (user_id, day) DO UPDATE SET
    scans = CASE
      WHEN p_field = 'scans' AND u.scans < p_limit THEN u.scans + 1
      ELSE u.scans
    END,
    director_msgs = CASE
      WHEN p_field = 'director_msgs' AND u.director_msgs < p_limit THEN u.director_msgs + 1
      ELSE u.director_msgs
    END,
    research_calls = CASE
      WHEN p_field = 'research_calls' AND coalesce(u.research_calls, 0) < p_limit
        THEN coalesce(u.research_calls, 0) + 1
      ELSE coalesce(u.research_calls, 0)
    END,
    updated_at = pg_catalog.now()
  WHERE
    (p_field = 'scans' AND u.scans < p_limit)
    OR (p_field = 'director_msgs' AND u.director_msgs < p_limit)
    OR (p_field = 'research_calls' AND coalesce(u.research_calls, 0) < p_limit)
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.usage_daily WHERE user_id = p_user_id AND day = v_day;
    v_count := CASE p_field
      WHEN 'scans' THEN coalesce(v_row.scans, 0)
      WHEN 'director_msgs' THEN coalesce(v_row.director_msgs, 0)
      ELSE coalesce(v_row.research_calls, 0)
    END;
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'quota_exceeded',
      'count', v_count,
      'limit', p_limit
    );
  END IF;

  v_count := CASE p_field
    WHEN 'scans' THEN coalesce(v_row.scans, 0)
    WHEN 'director_msgs' THEN coalesce(v_row.director_msgs, 0)
    ELSE coalesce(v_row.research_calls, 0)
  END;

  RETURN jsonb_build_object('ok', true, 'count', v_count, 'limit', p_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_user_scan_count(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.require_service_role();
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  UPDATE public.users
  SET total_scans = coalesce(total_scans, 0) + 1,
      last_seen = pg_catalog.now()
  WHERE user_id = trim(p_user_id);
  IF NOT FOUND THEN
    INSERT INTO public.users (user_id, total_scans, last_seen)
    VALUES (trim(p_user_id), 1, pg_catalog.now())
    ON CONFLICT (user_id) DO UPDATE SET
      total_scans = coalesce(public.users.total_scans, 0) + 1,
      last_seen = pg_catalog.now();
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key text,
  p_max integer,
  p_window_ms integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_window interval;
  v_row public.rate_limits%ROWTYPE;
  v_retry_ms integer;
  v_key text;
BEGIN
  PERFORM private.require_service_role();
  v_key := left(trim(both FROM coalesce(p_key, '')), 200);
  IF v_key = '' OR p_max IS NULL OR p_max < 1 OR p_window_ms IS NULL OR p_window_ms < 1 THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'invalid', 'retry_after_ms', 60000);
  END IF;

  v_window := (GREATEST(p_window_ms, 1)::text || ' milliseconds')::interval;

  INSERT INTO public.rate_limits AS rl (bucket_key, window_start, hit_count, updated_at)
  VALUES (v_key, v_now, 1, v_now)
  ON CONFLICT (bucket_key) DO UPDATE
  SET
    window_start = CASE
      WHEN rl.window_start + v_window <= v_now THEN v_now
      ELSE rl.window_start
    END,
    hit_count = CASE
      WHEN rl.window_start + v_window <= v_now THEN 1
      ELSE rl.hit_count + 1
    END,
    updated_at = v_now
  RETURNING * INTO v_row;

  IF v_row.hit_count > p_max THEN
    v_retry_ms := GREATEST(
      0,
      floor(EXTRACT(EPOCH FROM (v_row.window_start + v_window - v_now)) * 1000)::integer
    );
    RETURN jsonb_build_object(
      'allowed', false,
      'count', v_row.hit_count,
      'limit', p_max,
      'retry_after_ms', v_retry_ms
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'count', v_row.hit_count,
    'limit', p_max,
    'retry_after_ms', 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_stripe_event(p_event_id text, p_event_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.require_service_role();
  IF p_event_id IS NULL OR length(trim(p_event_id)) = 0 THEN
    RETURN jsonb_build_object('claimed', false, 'error', 'invalid');
  END IF;

  BEGIN
    INSERT INTO public.processed_stripe_events (event_id, event_type)
    VALUES (left(trim(p_event_id), 128), left(coalesce(p_event_type, ''), 120));
    RETURN jsonb_build_object('claimed', true);
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('claimed', false, 'duplicate', true);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_onboarding_scan(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_left integer;
BEGIN
  PERFORM private.require_service_role();
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_user');
  END IF;

  UPDATE public.users
  SET
    free_scans_remaining = free_scans_remaining - 1,
    last_seen = pg_catalog.now()
  WHERE user_id = trim(p_user_id)
    AND onboarding_reward_granted IS TRUE
    AND free_scans_remaining > 0
  RETURNING free_scans_remaining INTO v_left;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'none_remaining', 'consumed', false);
  END IF;

  RETURN jsonb_build_object('ok', true, 'consumed', true, 'remaining', v_left);
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_personal_workspace(p_user_id text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM private.require_service_role();
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RAISE EXCEPTION 'invalid_user';
  END IF;

  SELECT id INTO v_id
  FROM public.workspaces
  WHERE owner_id = p_user_id AND kind = 'personal'
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (v_id, p_user_id, 'owner')
    ON CONFLICT (workspace_id, user_id) DO NOTHING;
    RETURN v_id;
  END IF;

  INSERT INTO public.workspaces (name, owner_id, kind)
  VALUES ('Personal', p_user_id, 'personal')
  RETURNING id INTO v_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_id, p_user_id, 'owner')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_onboarding_reward(p_user_id text, p_timezone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_ends timestamptz;
  v_tz text;
BEGIN
  PERFORM private.require_service_role();
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_user');
  END IF;

  v_tz := public.preshoot_sanitize_tz(p_timezone);

  INSERT INTO public.users (user_id, last_seen, timezone)
  VALUES (trim(p_user_id), pg_catalog.now(), v_tz)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_user
  FROM public.users
  WHERE user_id = trim(p_user_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_missing');
  END IF;

  IF v_user.onboarding_reward_granted IS TRUE THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_granted', true,
      'granted', false,
      'free_scans_remaining', v_user.free_scans_remaining,
      'director_trial_ends_at', v_user.director_trial_ends_at,
      'studio_trial_ends_at', v_user.studio_trial_ends_at,
      'onboarding_reward_granted_at', v_user.onboarding_reward_granted_at
    );
  END IF;

  v_ends := pg_catalog.now() + interval '24 hours';

  UPDATE public.users
  SET
    onboarding_reward_granted = true,
    onboarding_reward_granted_at = pg_catalog.now(),
    free_scans_remaining = 3,
    director_trial_ends_at = v_ends,
    studio_trial_ends_at = v_ends,
    timezone = v_tz,
    last_seen = pg_catalog.now()
  WHERE user_id = v_user.user_id
    AND onboarding_reward_granted IS NOT TRUE;

  IF NOT FOUND THEN
    SELECT * INTO v_user FROM public.users WHERE user_id = trim(p_user_id);
    RETURN jsonb_build_object(
      'ok', true,
      'already_granted', true,
      'granted', false,
      'free_scans_remaining', v_user.free_scans_remaining,
      'director_trial_ends_at', v_user.director_trial_ends_at,
      'studio_trial_ends_at', v_user.studio_trial_ends_at,
      'onboarding_reward_granted_at', v_user.onboarding_reward_granted_at
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'already_granted', false,
    'granted', true,
    'free_scans_remaining', 3,
    'director_trial_ends_at', v_ends,
    'studio_trial_ends_at', v_ends,
    'onboarding_reward_granted_at', pg_catalog.now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_onboarding_scan(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_left integer;
BEGIN
  PERFORM private.require_service_role();
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_user');
  END IF;

  UPDATE public.users
  SET
    free_scans_remaining = LEAST(3, free_scans_remaining + 1),
    last_seen = pg_catalog.now()
  WHERE user_id = trim(p_user_id)
    AND onboarding_reward_granted IS TRUE
  RETURNING free_scans_remaining INTO v_left;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_granted');
  END IF;

  RETURN jsonb_build_object('ok', true, 'remaining', v_left);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_creation_activity(p_user_id text, p_kind text, p_timezone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_today date;
  v_yesterday date;
  v_current integer;
  v_longest integer;
  v_days jsonb;
  v_tz text;
  v_kind text;
  v_milestone integer;
  v_incremented boolean := false;
BEGIN
  PERFORM private.require_service_role();
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_user');
  END IF;

  v_kind := lower(coalesce(p_kind, 'studio'));
  IF v_kind NOT IN ('scan', 'idea', 'director', 'studio', 'plan', 'post') THEN
    v_kind := 'studio';
  END IF;

  v_tz := public.preshoot_sanitize_tz(p_timezone);
  v_today := public.preshoot_local_date(v_tz);
  v_yesterday := v_today - 1;

  INSERT INTO public.users (user_id, last_seen, timezone)
  VALUES (trim(p_user_id), pg_catalog.now(), v_tz)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_user
  FROM public.users
  WHERE user_id = trim(p_user_id)
  FOR UPDATE;

  IF v_user.streak_last_active_date IS NOT NULL
     AND v_user.streak_last_active_date = v_today THEN
    RETURN jsonb_build_object(
      'ok', true,
      'incremented', false,
      'current', v_user.streak_current,
      'longest', v_user.streak_longest,
      'last_active_date', v_user.streak_last_active_date,
      'days', coalesce(v_user.streak_days, '[]'::jsonb),
      'milestone', NULL,
      'kind', v_kind
    );
  END IF;

  IF v_user.streak_last_active_date IS NOT NULL
     AND v_user.streak_last_active_date = v_yesterday THEN
    v_current := coalesce(v_user.streak_current, 0) + 1;
  ELSE
    v_current := 1;
  END IF;

  v_longest := GREATEST(coalesce(v_user.streak_longest, 0), v_current);
  v_days := coalesce(v_user.streak_days, '[]'::jsonb);
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(v_days) x
    WHERE x = v_today::text
  ) THEN
    v_days := v_days || to_jsonb(v_today::text);
  END IF;
  WHILE jsonb_array_length(v_days) > 120 LOOP
    v_days := v_days - 0;
  END LOOP;

  v_incremented := true;
  v_milestone := CASE
    WHEN v_current IN (3, 7, 14, 30, 60, 100) THEN v_current
    ELSE NULL
  END;

  UPDATE public.users
  SET
    streak_current = v_current,
    streak_longest = v_longest,
    streak_last_active_date = v_today,
    streak_days = v_days,
    timezone = v_tz,
    last_seen = pg_catalog.now()
  WHERE user_id = v_user.user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'incremented', v_incremented,
    'current', v_current,
    'longest', v_longest,
    'last_active_date', v_today,
    'days', v_days,
    'milestone', v_milestone,
    'kind', v_kind
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_promo_code(p_code text, p_user_id text, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_promo public.promo_codes%ROWTYPE;
  v_norm text;
BEGIN
  PERFORM private.require_service_role();
  v_norm := upper(trim(both FROM coalesce(p_code, '')));
  IF v_norm = '' OR p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  v_norm := left(v_norm, 64);

  SELECT * INTO v_promo
  FROM public.promo_codes
  WHERE code = v_norm
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
  END IF;

  IF NOT v_promo.active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'inactive');
  END IF;

  IF v_promo.expires_at IS NOT NULL AND v_promo.expires_at <= pg_catalog.now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.promo_usage
    WHERE code = v_norm AND user_id = p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_redeemed');
  END IF;

  IF v_promo.redemption_count >= v_promo.max_redemptions THEN
    RETURN jsonb_build_object('ok', false, 'error', 'limit_reached');
  END IF;

  UPDATE public.promo_codes
  SET redemption_count = redemption_count + 1
  WHERE id = v_promo.id
    AND active = true
    AND redemption_count < max_redemptions
    AND (expires_at IS NULL OR expires_at > pg_catalog.now());

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'limit_reached');
  END IF;

  INSERT INTO public.promo_usage (code, user_id, email, promo_id)
  VALUES (v_norm, p_user_id, left(coalesce(p_email, ''), 320), v_promo.id);

  INSERT INTO public.subscriptions (
    user_id, email, plan, status, promo_code, started_at, updated_at
  ) VALUES (
    p_user_id,
    left(coalesce(p_email, ''), 320),
    'pro',
    'promo',
    v_norm,
    pg_catalog.now(),
    pg_catalog.now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    plan = 'pro',
    status = 'promo',
    promo_code = EXCLUDED.promo_code,
    email = COALESCE(NULLIF(EXCLUDED.email, ''), public.subscriptions.email),
    started_at = COALESCE(public.subscriptions.started_at, pg_catalog.now()),
    updated_at = pg_catalog.now(),
    revoked_at = NULL,
    revoked_reason = NULL;

  INSERT INTO public.subscription_events (user_id, email, event_type, payload)
  VALUES (
    p_user_id,
    left(coalesce(p_email, ''), 320),
    'promo.applied',
    jsonb_build_object('code', v_norm, 'promo_id', v_promo.id)
  );

  RETURN jsonb_build_object('ok', true, 'code', v_norm, 'promo_id', v_promo.id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_redeemed');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_daily_usage(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_usage_rollup(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_usage_daily(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_user_scan_count(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_stripe_event(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_onboarding_scan(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_personal_workspace(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_onboarding_reward(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_creation_activity(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redeem_promo_code(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_onboarding_scan(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_daily_usage(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_usage_rollup(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.bump_usage_daily(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.bump_user_scan_count(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_stripe_event(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_onboarding_scan(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_personal_workspace(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_onboarding_reward(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_creation_activity(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.redeem_promo_code(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_onboarding_scan(text) TO service_role;

-- Auth hook stays callable by Auth, not by Data API clients.
-- Do NOT add require_service_role() here — Auth invokes as supabase_auth_admin.
CREATE OR REPLACE FUNCTION public.preshoot_gate_suspended_jwt(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid text;
  claims jsonb;
  session_id text;
  row_status text;
  row_email text;
  v_ref text;
BEGIN
  uid := event->>'user_id';
  claims := coalesce(event->'claims', '{}'::jsonb);
  session_id := coalesce(claims->>'session_id', '');

  IF uid IS NULL OR length(uid) = 0 THEN
    RETURN event;
  END IF;

  SELECT u.account_status, u.email
    INTO row_status, row_email
  FROM public.users u
  WHERE u.user_id = uid
  LIMIT 1;

  IF row_status IS DISTINCT FROM 'suspended' THEN
    RETURN event;
  END IF;

  v_ref := 'hook:' || uid || ':' || coalesce(nullif(session_id, ''), pg_catalog.extract(epoch from pg_catalog.clock_timestamp())::text);

  BEGIN
    INSERT INTO public.admin_notifications (
      type, severity, title, body, user_id, user_email, href, source_ref, metadata
    ) VALUES (
      'suspended_login',
      'critical',
      'Suspended account attempted login',
      'Account: ' || coalesce(nullif(row_email, ''), uid) || '. Status: Blocked.',
      uid,
      nullif(row_email, ''),
      'users:' || uid,
      v_ref,
      jsonb_build_object('blocked', true, 'source', 'auth_hook')
    )
    ON CONFLICT (source_ref) DO NOTHING;
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  RETURN jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This account has been suspended.'
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.preshoot_custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT public.preshoot_gate_suspended_jwt(event);
$$;

REVOKE ALL ON FUNCTION public.preshoot_gate_suspended_jwt(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preshoot_custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preshoot_gate_suspended_jwt(jsonb) TO postgres, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.preshoot_custom_access_token_hook(jsonb) TO postgres, service_role, supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;

-- Future public functions should not inherit EXECUTE for browser roles.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

DO $$
BEGIN
  EXECUTE $c$
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
      REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC
  $c$;
  EXECUTE $c$
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
      REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated
  $c$;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Could not alter supabase_admin default privileges';
END;
$$;

NOTIFY pgrst, 'reload schema';
