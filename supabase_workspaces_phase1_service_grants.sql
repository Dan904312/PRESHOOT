/* Phase 1 hotfix: ensure service_role can mutate workspace tables.
   Safe to run multiple times. Does not change RLS for authenticated clients. */

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE workspaces TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE workspace_members TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE workspace_data TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE workspace_invites TO service_role;
