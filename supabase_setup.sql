-- ============================================
-- PRESHOOT SUBSCRIPTION + DATA SECURITY
-- Run this entire file in Supabase SQL Editor
-- ============================================

-- Main subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text UNIQUE,
  email text,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  status text DEFAULT 'none' CHECK (status IN ('active', 'cancelled', 'past_due', 'trialing', 'revoked', 'none', 'promo')),
  promo_code text,
  billing_interval text CHECK (billing_interval IN ('monthly', 'yearly', NULL)),
  notes text,
  started_at timestamptz,
  expires_at timestamptz,
  cancelled_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Promo code usage log (per-user redemptions)
CREATE TABLE IF NOT EXISTS promo_usage (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL,
  user_id text,
  email text,
  promo_id uuid,
  used_at timestamptz DEFAULT now()
);

-- Catalog of redeemable promo codes (limits + expiry)
CREATE TABLE IF NOT EXISTS promo_codes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL UNIQUE,
  max_redemptions integer NOT NULL DEFAULT 1 CHECK (max_redemptions > 0),
  redemption_count integer NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT promo_codes_count_lte_max CHECK (redemption_count <= max_redemptions)
);

-- Existing deployments: add promo_id if missing
ALTER TABLE promo_usage ADD COLUMN IF NOT EXISTS promo_id uuid;

-- Remove duplicate redemptions from pre-limit promo abuse (keep earliest row)
DELETE FROM promo_usage a
USING promo_usage b
WHERE a.user_id IS NOT NULL
  AND a.code = b.code
  AND a.user_id = b.user_id
  AND (
    a.used_at > b.used_at
    OR (a.used_at = b.used_at AND a.id::text > b.id::text)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_usage_user_code
  ON promo_usage (code, user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_promo_usage_code ON promo_usage(code);

DO $$ BEGIN
  ALTER TABLE promo_usage
    ADD CONSTRAINT promo_usage_promo_id_fkey
    FOREIGN KEY (promo_id) REFERENCES promo_codes(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Atomic redeem: active + not expired + under max + one redemption per user
CREATE OR REPLACE FUNCTION redeem_promo_code(p_code text, p_user_id text, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promo promo_codes%ROWTYPE;
  v_norm text;
BEGIN
  v_norm := upper(trim(both FROM coalesce(p_code, '')));
  IF v_norm = '' OR p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  v_norm := left(v_norm, 64);

  SELECT * INTO v_promo
  FROM promo_codes
  WHERE code = v_norm
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
  END IF;

  IF NOT v_promo.active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'inactive');
  END IF;

  IF v_promo.expires_at IS NOT NULL AND v_promo.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  IF EXISTS (
    SELECT 1 FROM promo_usage
    WHERE code = v_norm AND user_id = p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_redeemed');
  END IF;

  IF v_promo.redemption_count >= v_promo.max_redemptions THEN
    RETURN jsonb_build_object('ok', false, 'error', 'limit_reached');
  END IF;

  UPDATE promo_codes
  SET redemption_count = redemption_count + 1
  WHERE id = v_promo.id
    AND active = true
    AND redemption_count < max_redemptions
    AND (expires_at IS NULL OR expires_at > now());

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'limit_reached');
  END IF;

  INSERT INTO promo_usage (code, user_id, email, promo_id)
  VALUES (v_norm, p_user_id, left(coalesce(p_email, ''), 320), v_promo.id);

  INSERT INTO subscriptions (
    user_id, email, plan, status, promo_code, started_at, updated_at
  ) VALUES (
    p_user_id,
    left(coalesce(p_email, ''), 320),
    'pro',
    'promo',
    v_norm,
    now(),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    plan = 'pro',
    status = 'promo',
    promo_code = EXCLUDED.promo_code,
    email = COALESCE(NULLIF(EXCLUDED.email, ''), subscriptions.email),
    started_at = COALESCE(subscriptions.started_at, now()),
    updated_at = now(),
    revoked_at = NULL,
    revoked_reason = NULL;

  INSERT INTO subscription_events (user_id, email, event_type, payload)
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

REVOKE ALL ON FUNCTION redeem_promo_code(text, text, text) FROM PUBLIC;
-- PostgREST service role uses this RPC; authenticated/anon must not call it.
GRANT EXECUTE ON FUNCTION redeem_promo_code(text, text, text) TO service_role;

-- Example seed (edit before running in production):
-- INSERT INTO promo_codes (code, max_redemptions, expires_at, active)
-- VALUES ('LAUNCH50', 50, now() + interval '30 days', true)
-- ON CONFLICT (code) DO NOTHING;

-- Subscription event log (full audit trail)
CREATE TABLE IF NOT EXISTS subscription_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text,
  email text,
  event_type text NOT NULL,
  payload jsonb,
  amount numeric,
  stripe_event_id text UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- Stripe webhook idempotency (claim before side effects)
CREATE TABLE IF NOT EXISTS processed_stripe_events (
  event_id text PRIMARY KEY,
  event_type text,
  processed_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION claim_stripe_event(p_event_id text, p_event_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_event_id IS NULL OR length(trim(p_event_id)) = 0 THEN
    RETURN jsonb_build_object('claimed', false, 'error', 'invalid');
  END IF;

  BEGIN
    INSERT INTO processed_stripe_events (event_id, event_type)
    VALUES (left(trim(p_event_id), 128), left(coalesce(p_event_type, ''), 120));
    RETURN jsonb_build_object('claimed', true);
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('claimed', false, 'duplicate', true);
  END;
END;
$$;

REVOKE ALL ON FUNCTION claim_stripe_event(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_stripe_event(text, text) TO service_role;

-- All signed-in users (free + pro)
CREATE TABLE IF NOT EXISTS users (
  user_id text PRIMARY KEY,
  email text,
  name text,
  avatar text,
  provider text,
  total_scans integer DEFAULT 0,
  first_seen timestamptz DEFAULT now(),
  last_seen timestamptz DEFAULT now()
);

-- Cross-device app data
CREATE TABLE IF NOT EXISTS user_data (
  user_id text PRIMARY KEY,
  history jsonb DEFAULT '[]'::jsonb,
  library jsonb DEFAULT '[]'::jsonb,
  director_history jsonb DEFAULT '[]'::jsonb,
  niche jsonb DEFAULT '{}'::jsonb,
  platform_focus jsonb DEFAULT '{}'::jsonb,
  aesthetic jsonb DEFAULT '{}'::jsonb,
  gear jsonb DEFAULT '{}'::jsonb,
  profile jsonb DEFAULT '{}'::jsonb,
  prefs jsonb DEFAULT '{}'::jsonb,
  -- Phase 1 Studio: also mirrored inside prefs.studio for seamless sync
  -- without requiring an immediate production ALTER. Optional top-level column:
  studio jsonb DEFAULT '{"version":1,"projects":[],"continueProductionId":null}'::jsonb,
  updated_at timestamptz DEFAULT now()
);

-- Existing deployments: run once
-- ALTER TABLE user_data ADD COLUMN IF NOT EXISTS studio jsonb DEFAULT '{"version":1,"projects":[],"continueProductionId":null}'::jsonb;

-- Server-side daily quotas (scans + Director messages + research calls)
CREATE TABLE IF NOT EXISTS usage_daily (
  user_id text NOT NULL,
  day date NOT NULL,
  scans integer DEFAULT 0,
  director_msgs integer DEFAULT 0,
  research_calls integer DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

-- Existing deployments: run once
-- ALTER TABLE usage_daily ADD COLUMN IF NOT EXISTS research_calls integer DEFAULT 0;

-- Atomic daily usage bump (prevents concurrent quota bypass)
CREATE OR REPLACE FUNCTION bump_usage_daily(
  p_user_id text,
  p_field text,
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := (timezone('utc', now()))::date;
  v_row usage_daily%ROWTYPE;
  v_count integer;
BEGIN
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_user');
  END IF;
  IF p_field IS NULL OR p_field NOT IN ('scans', 'director_msgs', 'research_calls') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_field');
  END IF;
  IF p_limit IS NULL OR p_limit < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_limit');
  END IF;

  INSERT INTO usage_daily AS u (
    user_id, day, scans, director_msgs, research_calls, updated_at
  ) VALUES (
    p_user_id,
    v_day,
    CASE WHEN p_field = 'scans' THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'director_msgs' THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'research_calls' THEN 1 ELSE 0 END,
    now()
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
    updated_at = now()
  WHERE
    (p_field = 'scans' AND u.scans < p_limit)
    OR (p_field = 'director_msgs' AND u.director_msgs < p_limit)
    OR (p_field = 'research_calls' AND coalesce(u.research_calls, 0) < p_limit)
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT * INTO v_row FROM usage_daily WHERE user_id = p_user_id AND day = v_day;
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

REVOKE ALL ON FUNCTION bump_usage_daily(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bump_usage_daily(text, text, integer) TO service_role;

-- Distributed rate-limit buckets (shared across Vercel serverless instances)
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  hit_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_updated ON rate_limits(updated_at);

CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key text,
  p_max integer,
  p_window_ms integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_window interval;
  v_row rate_limits%ROWTYPE;
  v_retry_ms integer;
  v_key text;
BEGIN
  v_key := left(trim(both FROM coalesce(p_key, '')), 200);
  IF v_key = '' OR p_max IS NULL OR p_max < 1 OR p_window_ms IS NULL OR p_window_ms < 1 THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'invalid', 'retry_after_ms', 60000);
  END IF;

  v_window := (GREATEST(p_window_ms, 1)::text || ' milliseconds')::interval;

  INSERT INTO rate_limits AS rl (bucket_key, window_start, hit_count, updated_at)
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

REVOKE ALL ON FUNCTION check_rate_limit(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_rate_limit(text, integer, integer) TO service_role;

-- Optional cleanup (run periodically in SQL editor / cron):
-- DELETE FROM rate_limits WHERE updated_at < now() - interval '2 days';

-- Admin dashboard sessions (HttpOnly cookie token → hashed row)
CREATE TABLE IF NOT EXISTS admin_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_revoked ON admin_sessions(revoked_at);

-- Optional cleanup:
-- DELETE FROM admin_sessions WHERE expires_at < now() - interval '7 days';

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_cus ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_events_user ON subscription_events(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen);
CREATE INDEX IF NOT EXISTS idx_usage_day ON usage_daily(day);

-- Auto-update updated_at on any change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subscriptions_updated_at ON subscriptions;
CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- Client uses anon key; all privileged access
-- goes through Vercel APIs with service role.
-- Deny all direct client access by default.
-- ============================================

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;

-- Drop any prior open policies if re-running
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE tablename IN ('subscriptions','promo_usage','promo_codes','subscription_events','processed_stripe_events','users','user_data','usage_daily','rate_limits','admin_sessions')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- No policies for anon/authenticated = deny all via PostgREST.
-- Service role bypasses RLS.

-- Optional: authenticated users may read ONLY their own subscription row
CREATE POLICY subscriptions_select_own ON subscriptions
  FOR SELECT TO authenticated
  USING (auth.uid()::text = user_id);

CREATE POLICY user_data_select_own ON user_data
  FOR SELECT TO authenticated
  USING (auth.uid()::text = user_id);

CREATE POLICY users_select_own ON users
  FOR SELECT TO authenticated
  USING (auth.uid()::text = user_id);

-- Explicitly revoke table grants from anon (defense in depth)
REVOKE ALL ON TABLE subscriptions FROM anon, authenticated;
REVOKE ALL ON TABLE promo_usage FROM anon, authenticated;
REVOKE ALL ON TABLE promo_codes FROM anon, authenticated;
REVOKE ALL ON TABLE subscription_events FROM anon, authenticated;
REVOKE ALL ON TABLE processed_stripe_events FROM anon, authenticated;
REVOKE ALL ON TABLE users FROM anon, authenticated;
REVOKE ALL ON TABLE user_data FROM anon, authenticated;
REVOKE ALL ON TABLE usage_daily FROM anon, authenticated;
REVOKE ALL ON TABLE rate_limits FROM anon, authenticated;
REVOKE ALL ON TABLE admin_sessions FROM anon, authenticated;

GRANT SELECT ON TABLE subscriptions TO authenticated;
GRANT SELECT ON TABLE user_data TO authenticated;

-- Enable Realtime for cross-device Studio sync (client subscribes in studio-sync.js)
-- Run once in Supabase if not already published:
-- ALTER PUBLICATION supabase_realtime ADD TABLE user_data;
GRANT SELECT ON TABLE users TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- Production asset storage (Supabase Storage)
-- Create bucket via Dashboard or API; policies below for authenticated users.
-- The /api/upload route uses the service role and enforces user_id path prefix.
-- ═══════════════════════════════════════════════════════════
-- INSERT INTO storage.buckets (id, name, public, file_size_limit)
-- VALUES ('production-assets', 'production-assets', false, 12582912)
-- ON CONFLICT (id) DO NOTHING;
--
-- Storage objects paths: {user_id}/{production_id}/{asset_id}.{ext}
-- Clients never receive the service key; they upload via /api/upload.

-- ═══════════════════════════════════════════════════════════
-- Collaborative Workspaces Phase 1
-- Run supabase_workspaces_phase1.sql in the Supabase SQL Editor
-- (tables, RLS, helpers, personal metadata backfill).
-- Personal Studio remains in user_data.prefs.studio — do not copy.
-- Shared Studio lives in workspace_data.document.
--
-- Phase 3A Realtime: also run supabase_workspaces_phase3a_realtime.sql
-- Phase 4 Versions: also run supabase_workspaces_phase4_versions.sql
-- Phase 5A Change metadata: also run supabase_workspaces_phase5a_changes.sql
-- (private Broadcast channel RLS on realtime.messages).
-- ═══════════════════════════════════════════════════════════

