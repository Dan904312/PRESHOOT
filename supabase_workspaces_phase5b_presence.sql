-- ============================================
-- PRESHOOT WORKSPACES PHASE 5B — PRESENCE INSERT
-- Ephemeral Realtime Presence for shared workspaces.
-- Idempotent. Does NOT create Studio tables or touch user_data.
-- Members may TRACK presence on workspace:{uuid} topics only.
-- Broadcast INSERT remains denied (service_role only).
-- ============================================

GRANT EXECUTE ON FUNCTION is_workspace_member(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_id_from_realtime_topic() TO authenticated, service_role;

DROP POLICY IF EXISTS workspace_realtime_presence_insert ON realtime.messages;

-- Members can publish their own ephemeral presence on workspace topics
CREATE POLICY workspace_realtime_presence_insert
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  extension = 'presence'
  AND public.workspace_id_from_realtime_topic() IS NOT NULL
  AND public.is_workspace_member(
    public.workspace_id_from_realtime_topic(),
    (SELECT auth.uid()::text)
  )
);

-- Keep broadcast INSERT denied for authenticated (no policy = deny)

COMMENT ON POLICY workspace_realtime_presence_insert ON realtime.messages IS
  'Phase 5B: members may track ephemeral presence on workspace:{uuid}; no document payloads.';
