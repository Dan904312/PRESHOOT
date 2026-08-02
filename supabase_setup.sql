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

-- Promo code usage log
CREATE TABLE IF NOT EXISTS promo_usage (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL,
  user_id text,
  email text,
  used_at timestamptz DEFAULT now()
);

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

-- Server-side daily quotas (scans + Director messages)
CREATE TABLE IF NOT EXISTS usage_daily (
  user_id text NOT NULL,
  day date NOT NULL,
  scans integer DEFAULT 0,
  director_msgs integer DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

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
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_daily ENABLE ROW LEVEL SECURITY;

-- Drop any prior open policies if re-running
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE tablename IN ('subscriptions','promo_usage','subscription_events','users','user_data','usage_daily')
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
REVOKE ALL ON TABLE subscription_events FROM anon, authenticated;
REVOKE ALL ON TABLE users FROM anon, authenticated;
REVOKE ALL ON TABLE user_data FROM anon, authenticated;
REVOKE ALL ON TABLE usage_daily FROM anon, authenticated;

GRANT SELECT ON TABLE subscriptions TO authenticated;
GRANT SELECT ON TABLE user_data TO authenticated;
GRANT SELECT ON TABLE users TO authenticated;
