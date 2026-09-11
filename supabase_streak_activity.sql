/* ============================================
   PRESHOOT — streak activity events + milestone rewards
   Additive. Safe to run more than once.
   Does not touch subscriptions / Stripe.
   Service role only. Never expose another user's activity.
   ============================================ */

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS streak_director_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS streak_studio_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS streak_freeze_until date,
  ADD COLUMN IF NOT EXISTS streak_backfilled_at timestamptz;

CREATE TABLE IF NOT EXISTS activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  local_date date NOT NULL,
  workspace_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS activity_events_user_day_kind
  ON activity_events (user_id, local_date, event_type);

CREATE INDEX IF NOT EXISTS activity_events_user_date
  ON activity_events (user_id, local_date DESC);

ALTER TABLE activity_events
  DROP CONSTRAINT IF EXISTS activity_events_event_type_check;

ALTER TABLE activity_events
  ADD CONSTRAINT activity_events_event_type_check
  CHECK (event_type IN (
    'scan', 'idea', 'director', 'studio', 'plan', 'post',
    'onboarding', 'project', 'script', 'shotlist', 'save'
  ));

CREATE TABLE IF NOT EXISTS streak_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  milestone integer NOT NULL,
  reward_kind text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  director boolean NOT NULL DEFAULT false,
  studio boolean NOT NULL DEFAULT false,
  hours integer NOT NULL DEFAULT 0,
  plan_at_grant text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, milestone)
);

ALTER TABLE streak_rewards
  DROP CONSTRAINT IF EXISTS streak_rewards_kind_check;

ALTER TABLE streak_rewards
  ADD CONSTRAINT streak_rewards_kind_check
  CHECK (reward_kind IN ('access', 'achievement'));

CREATE INDEX IF NOT EXISTS streak_rewards_user
  ON streak_rewards (user_id, milestone);

ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE streak_rewards ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE activity_events FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE streak_rewards FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE activity_events TO service_role;
GRANT ALL ON TABLE streak_rewards TO service_role;

/* Keep the existing RPC in sync with extra kinds. JS is the primary writer;
   this remains a compatible fallback. */
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
  IF v_kind NOT IN (
    'scan', 'idea', 'director', 'studio', 'plan', 'post',
    'onboarding', 'project', 'script', 'shotlist', 'save'
  ) THEN
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

  INSERT INTO activity_events (user_id, event_type, local_date, occurred_at)
  VALUES (trim(p_user_id), v_kind, v_today, now())
  ON CONFLICT (user_id, local_date, event_type) DO NOTHING;

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
    WHEN v_current IN (3, 7, 10, 30, 60, 100) THEN v_current
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

REVOKE ALL ON FUNCTION record_creation_activity(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_creation_activity(text, text, text) TO service_role;
