-- ============================================
-- PRESHOOT SUBSCRIPTION MANAGEMENT
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
  stripe_event_id text UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_cus ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_events_user ON subscription_events(user_id);

-- Auto-update updated_at on any change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subscriptions_updated_at ON subscriptions;
CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Disable RLS (service key used server-side only)
ALTER TABLE subscriptions DISABLE ROW LEVEL SECURITY;
ALTER TABLE promo_usage DISABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_events DISABLE ROW LEVEL SECURITY;
