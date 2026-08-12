-- Phase 1 hotfix: ensure service_role can mutate workspace tables.
-- Safe to run multiple times. Does not change RLS for authenticated clients.
-- Mutations remain API-only (service role); clients stay SELECT-only.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE workspaces TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE workspace_members TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE workspace_data TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE workspace_invites TO service_role;

-- Confirm tables exist (no-op selects for operators running in SQL editor)
-- SELECT 'workspaces' AS t, count(*) FROM workspaces
-- UNION ALL SELECT 'workspace_members', count(*) FROM workspace_members
-- UNION ALL SELECT 'workspace_data', count(*) FROM workspace_data;
