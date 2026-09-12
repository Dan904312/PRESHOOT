/* ============================================
   PRESHOOT — Admin daily usage rollup
   Additive. Safe to run more than once.
   Service role only. Does not invent history.
   Requires usage_events from supabase_admin_console.sql.

   SECURITY: This file may CREATE OR REPLACE DEFINER RPCs.
   After any paste, ALWAYS re-run sql/20260911_security_definer_hardening.sql LAST
   so require_service_role + search_path='' remain the live bodies.
   ============================================ */

CREATE SCHEMA IF NOT EXISTS private;
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

-- guarded: require_service_role + search_path='' (re-run lock)
CREATE OR REPLACE FUNCTION admin_daily_usage(p_since timestamptz DEFAULT NULL)
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

REVOKE ALL ON FUNCTION admin_daily_usage(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_daily_usage(timestamptz) TO service_role;
