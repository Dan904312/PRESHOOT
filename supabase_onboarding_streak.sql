/* ============================================
   PRESHOOT — onboarding reward + creator streak
   Additive. Safe to run more than once.
   Extends public.users — does not touch subscriptions/Stripe.
   Stores hashes/counters only. Never trusts localStorage.
   ============================================ */

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_reward_granted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_reward_granted_at timestamptz,
  ADD COLUMN IF NOT EXISTS free_scans_remaining integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS director_trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS studio_trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS streak_current integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_longest integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_last_active_date date,
  ADD COLUMN IF NOT EXISTS streak_days jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'UTC';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_free_scans_remaining_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_free_scans_remaining_check
      CHECK (free_scans_remaining >= 0 AND free_scans_remaining <= 3);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION preshoot_sanitize_tz(p_tz text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_tz text;
BEGIN
  v_tz := coalesce(nullif(trim(both FROM coalesce(p_tz, '')), ''), 'UTC');
  IF v_tz !~ '^[A-Za-z0-9_+\-/]{1,64}$' THEN
    RETURN 'UTC';
  END IF;
  BEGIN
    PERFORM timezone(v_tz, now());
    RETURN v_tz;
  EXCEPTION WHEN others THEN
    RETURN 'UTC';
  END;
END;
$$;

CREATE OR REPLACE FUNCTION preshoot_local_date(p_tz text)
RETURNS date
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_tz text;
BEGIN
  v_tz := preshoot_sanitize_tz(p_tz);
  BEGIN
    RETURN (timezone(v_tz, now()))::date;
  EXCEPTION WHEN others THEN
    RETURN (timezone('UTC', now()))::date;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION grant_onboarding_reward(p_user_id text, p_timezone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user users%ROWTYPE;
  v_ends timestamptz;
  v_tz text;
BEGIN
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_user');
  END IF;

  v_tz := preshoot_sanitize_tz(p_timezone);

  INSERT INTO users (user_id, last_seen, timezone)
  VALUES (trim(p_user_id), now(), v_tz)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_user
  FROM users
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

  v_ends := now() + interval '24 hours';

  UPDATE users
  SET
    onboarding_reward_granted = true,
    onboarding_reward_granted_at = now(),
    free_scans_remaining = 3,
    director_trial_ends_at = v_ends,
    studio_trial_ends_at = v_ends,
    timezone = v_tz,
    last_seen = now()
  WHERE user_id = v_user.user_id
    AND onboarding_reward_granted IS NOT TRUE;

  IF NOT FOUND THEN
    SELECT * INTO v_user FROM users WHERE user_id = trim(p_user_id);
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
    'onboarding_reward_granted_at', now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION consume_onboarding_scan(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_left integer;
BEGIN
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_user');
  END IF;

  UPDATE users
  SET
    free_scans_remaining = free_scans_remaining - 1,
    last_seen = now()
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

CREATE OR REPLACE FUNCTION refund_onboarding_scan(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_left integer;
BEGIN
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_user');
  END IF;

  UPDATE users
  SET
    free_scans_remaining = LEAST(3, free_scans_remaining + 1),
    last_seen = now()
  WHERE user_id = trim(p_user_id)
    AND onboarding_reward_granted IS TRUE
  RETURNING free_scans_remaining INTO v_left;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_granted');
  END IF;

  RETURN jsonb_build_object('ok', true, 'remaining', v_left);
END;
$$;

CREATE OR REPLACE FUNCTION record_creation_activity(p_user_id text, p_kind text, p_timezone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user users%ROWTYPE;
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
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_user');
  END IF;

  v_kind := lower(coalesce(p_kind, 'studio'));
  IF v_kind NOT IN ('scan', 'idea', 'director', 'studio') THEN
    v_kind := 'studio';
  END IF;

  v_tz := preshoot_sanitize_tz(p_timezone);
  v_today := preshoot_local_date(v_tz);
  v_yesterday := v_today - 1;

  INSERT INTO users (user_id, last_seen, timezone)
  VALUES (trim(p_user_id), now(), v_tz)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_user
  FROM users
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

  UPDATE users
  SET
    streak_current = v_current,
    streak_longest = v_longest,
    streak_last_active_date = v_today,
    streak_days = v_days,
    timezone = v_tz,
    last_seen = now()
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

REVOKE ALL ON FUNCTION preshoot_sanitize_tz(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION preshoot_local_date(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION grant_onboarding_reward(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION consume_onboarding_scan(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refund_onboarding_scan(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_creation_activity(text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION preshoot_sanitize_tz(text) TO service_role;
GRANT EXECUTE ON FUNCTION preshoot_local_date(text) TO service_role;
GRANT EXECUTE ON FUNCTION grant_onboarding_reward(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION consume_onboarding_scan(text) TO service_role;
GRANT EXECUTE ON FUNCTION refund_onboarding_scan(text) TO service_role;
GRANT EXECUTE ON FUNCTION record_creation_activity(text, text, text) TO service_role;
