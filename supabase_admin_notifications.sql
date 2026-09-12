/* ============================================
   PRESHOOT — Admin notifications (additive)
   Safe to run more than once.
   Service role only. Never expose to anon.

   SECURITY: This file may CREATE OR REPLACE DEFINER Auth hooks.
   After any paste, ALWAYS re-run sql/20260911_security_definer_hardening.sql LAST
   so search_path='' remains on hook bodies.
   Do NOT add require_service_role() to Auth hooks — Auth calls them as
   supabase_auth_admin, not service_role.
   ============================================ */

CREATE TABLE IF NOT EXISTS admin_notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  type text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  user_id text,
  user_email text,
  href text,
  source_ref text UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_notifications_type_check
    CHECK (type IN ('account_suspended', 'account_restored', 'suspended_login', 'security', 'system')),
  CONSTRAINT admin_notifications_severity_check
    CHECK (severity IN ('critical', 'warning', 'info'))
);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_created
  ON admin_notifications (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_unread
  ON admin_notifications (created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE admin_notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE admin_notifications FROM anon, authenticated;
GRANT ALL ON TABLE admin_notifications TO service_role;

/*
  Optional Auth hook (Dashboard: Authentication > Hooks > Custom Access Token)
  URI: pg-functions://postgres/public/preshoot_custom_access_token_hook

  Official Auth Hooks (Free plan). Active users are unchanged if the hook
  is not enabled. When enabled, Auth refuses JWT issuance for suspended
  accounts and records a notification per Auth session.
*/

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

  v_ref := 'hook:' || uid || ':' || coalesce(nullif(session_id, ''), pg_catalog.date_part('epoch', pg_catalog.clock_timestamp())::text);

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
