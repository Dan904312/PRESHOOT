/* ============================================
   PRESHOOT — Admin console SQL (one paste)
   Additive. Safe to run more than once.

   Embeds sql/users_account_status.sql so operators
   can paste this file alone. Running
   sql/users_account_status.sql first, then this file,
   is also safe (IF NOT EXISTS / duplicate_object).

   Creates / keeps:
     public.usage_events
     public.admin_audit_log
     public.app_settings  (usage_tracking_started_at ON CONFLICT DO NOTHING)
     public.admin_email_log

   Column types match lib/usage-ledger.js, lib/admin-audit.js,
   and api/admin-data.js inserts.

   RLS on. REVOKE anon + authenticated. GRANT service_role only.
   Do not grant anon/authenticated write on users, usage_events,
   or admin_audit_log.

   Retention intent (manual / future cron):
     usage_events      24 months
     admin_audit_log   24 months
     admin_email_log   24 months

   Also run supabase_admin_notifications.sql for the admin bell.
   ============================================ */

-- ── A. account_status (same block as sql/users_account_status.sql) ──

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS account_status_reason text,
  ADD COLUMN IF NOT EXISTS account_status_at timestamptz,
  ADD COLUMN IF NOT EXISTS account_status_by text;

DO $$ BEGIN
  ALTER TABLE public.users
    ADD CONSTRAINT users_account_status_check
    CHECK (account_status IN ('active', 'suspended'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_account_status
  ON public.users (account_status);

CREATE INDEX IF NOT EXISTS idx_users_account_status_at
  ON public.users (account_status_at DESC NULLS LAST)
  WHERE account_status = 'suspended';

COMMENT ON COLUMN public.users.account_status IS
  'active|suspended — enforced by requireActiveUser / setAccountStatus';

-- ── B. Admin telemetry tables ──

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
