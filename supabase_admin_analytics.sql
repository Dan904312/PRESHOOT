/* ============================================
   PRESHOOT — Admin daily usage rollup
   Additive. Safe to run more than once.
   Service role only. Does not invent history.
   Requires usage_events from supabase_admin_console.sql.
   ============================================ */

CREATE OR REPLACE FUNCTION admin_daily_usage(p_since timestamptz DEFAULT NULL)
RETURNS TABLE(
  day date,
  scans bigint,
  ai_requests bigint,
  active_users bigint,
  cost_sum numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (ue.created_at AT TIME ZONE 'utc')::date,
    count(*) FILTER (WHERE ue.event_type = 'scan')::bigint,
    count(*)::bigint,
    count(DISTINCT ue.user_id)::bigint,
    coalesce(sum(ue.estimated_cost), 0)
  FROM usage_events ue
  WHERE ue.status = 'success'
    AND (p_since IS NULL OR ue.created_at >= p_since)
  GROUP BY 1
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION admin_daily_usage(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_daily_usage(timestamptz) TO service_role;
