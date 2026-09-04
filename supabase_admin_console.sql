/* ============================================
   PRESHOOT — Admin console: usage ledger, account
   status, audit log, email log.
   Additive. Safe to run more than once.
   Service role only. Never expose to anon.
   Retention (manual / future cron):
     usage_events      24 months
     admin_audit_log   24 months
     admin_email_log   24 months
   ============================================ */

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS account_status_reason text,
  ADD COLUMN IF NOT EXISTS account_status_at timestamptz,
  ADD COLUMN IF NOT EXISTS account_status_by text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_account_status_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_account_status_check
      CHECK (account_status IN ('active', 'suspended'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_account_status ON users (account_status);

CREATE TABLE IF NOT EXISTS usage_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text,
  event_type text NOT NULL,
  provider text,
  model text,
  request_id text,
  input_units integer,
  output_units integer,
  estimated_cost numeric,
  status text NOT NULL DEFAULT 'success',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_user_created
  ON usage_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_type_created
  ON usage_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_created
  ON usage_events (created_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO app_settings (key, value)
VALUES ('usage_tracking_started_at', now()::text)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_id text NOT NULL DEFAULT 'admin',
  action text NOT NULL,
  target_user_id text,
  ip text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log (created_at DESC);

CREATE TABLE IF NOT EXISTS admin_email_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid,
  admin_id text NOT NULL DEFAULT 'admin',
  recipient_user_id text,
  recipient_email text,
  subject text,
  status text NOT NULL,
  provider text,
  provider_message_id text,
  error text,
  sent_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_email_sent ON admin_email_log (sent_at DESC);

CREATE OR REPLACE FUNCTION bump_user_scan_count(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  UPDATE users
  SET total_scans = coalesce(total_scans, 0) + 1,
      last_seen = now()
  WHERE user_id = trim(p_user_id);
  IF NOT FOUND THEN
    INSERT INTO users (user_id, total_scans, last_seen)
    VALUES (trim(p_user_id), 1, now())
    ON CONFLICT (user_id) DO UPDATE SET
      total_scans = coalesce(users.total_scans, 0) + 1,
      last_seen = now();
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION bump_user_scan_count(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bump_user_scan_count(text) TO service_role;

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_email_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE usage_events FROM anon, authenticated;
REVOKE ALL ON TABLE admin_audit_log FROM anon, authenticated;
REVOKE ALL ON TABLE admin_email_log FROM anon, authenticated;
REVOKE ALL ON TABLE app_settings FROM anon, authenticated;

GRANT ALL ON TABLE usage_events TO service_role;
GRANT ALL ON TABLE admin_audit_log TO service_role;
GRANT ALL ON TABLE admin_email_log TO service_role;
GRANT ALL ON TABLE app_settings TO service_role;

CREATE OR REPLACE FUNCTION admin_usage_rollup(p_since timestamptz DEFAULT NULL)
RETURNS TABLE(
  user_id text,
  event_type text,
  provider text,
  model text,
  event_count bigint,
  cost_sum numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ue.user_id,
    ue.event_type,
    ue.provider,
    ue.model,
    count(*)::bigint,
    coalesce(sum(ue.estimated_cost), 0)
  FROM usage_events ue
  WHERE ue.status = 'success'
    AND (p_since IS NULL OR ue.created_at >= p_since)
  GROUP BY 1, 2, 3, 4;
$$;

REVOKE ALL ON FUNCTION admin_usage_rollup(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_usage_rollup(timestamptz) TO service_role;

-- Also run supabase_admin_notifications.sql for the admin bell / suspended-login events.


