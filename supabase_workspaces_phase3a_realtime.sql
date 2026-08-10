-- ============================================
-- PRESHOOT WORKSPACES PHASE 3A — REALTIME
-- Private Broadcast channels for shared workspaces.
-- Safe to run multiple times (idempotent).
--
-- Clients subscribe with: channel('workspace:{uuid}', { config: { private: true } })
-- Authorization uses existing is_workspace_member().
-- Authenticated clients may RECEIVE broadcasts; they may NOT SEND.
-- Server (service_role) broadcasts after authoritative /api/workspace-sync saves.
-- Presence receive is allowed for future Phase 3B (no presence client yet).
-- ============================================

-- Ensure helper is available to realtime policy evaluation
GRANT EXECUTE ON FUNCTION is_workspace_member(uuid, text) TO authenticated, service_role;

-- Topic format: workspace:<uuid>
CREATE OR REPLACE FUNCTION public.workspace_id_from_realtime_topic()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t text;
  part text;
BEGIN
  t := realtime.topic();
  IF t IS NULL OR t NOT LIKE 'workspace:%' THEN
    RETURN NULL;
  END IF;
  part := split_part(t, ':', 2);
  IF part !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN part::uuid;
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_id_from_realtime_topic() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.workspace_id_from_realtime_topic() TO authenticated, service_role;

-- Drop prior Phase 3A policies if re-run
DROP POLICY IF EXISTS workspace_realtime_broadcast_select ON realtime.messages;
DROP POLICY IF EXISTS workspace_realtime_presence_select ON realtime.messages;
DROP POLICY IF EXISTS workspace_realtime_broadcast_insert ON realtime.messages;
DROP POLICY IF EXISTS workspace_realtime_presence_insert ON realtime.messages;

-- Members can receive workspace.updated (and other) broadcasts
CREATE POLICY workspace_realtime_broadcast_select
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  extension = 'broadcast'
  AND public.workspace_id_from_realtime_topic() IS NOT NULL
  AND public.is_workspace_member(
    public.workspace_id_from_realtime_topic(),
    (SELECT auth.uid()::text)
  )
);

-- Members can receive presence (future-ready; no client presence in 3A)
CREATE POLICY workspace_realtime_presence_select
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  extension = 'presence'
  AND public.workspace_id_from_realtime_topic() IS NOT NULL
  AND public.is_workspace_member(
    public.workspace_id_from_realtime_topic(),
    (SELECT auth.uid()::text)
  )
);

-- No authenticated INSERT for broadcast/presence — service_role only emits events.
-- (Absence of INSERT policies = deny for authenticated.)

COMMENT ON FUNCTION public.workspace_id_from_realtime_topic() IS
  'Phase 3A: map private realtime topic workspace:{uuid} → workspace id for RLS.';
