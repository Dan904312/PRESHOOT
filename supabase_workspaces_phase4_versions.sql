-- ============================================
-- PRESHOOT WORKSPACES PHASE 4 — VERSION HISTORY
-- Safe to run multiple times (idempotent).
-- workspace_data.document remains authoritative current state.
-- Versions are recovery snapshots of successful shared saves only.
-- ============================================

CREATE TABLE IF NOT EXISTS workspace_document_versions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  revision bigint NOT NULL,
  document jsonb NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL DEFAULT 'save'
    CHECK (reason IN ('save', 'restore'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_document_versions_ws_rev
  ON workspace_document_versions (workspace_id, revision);

CREATE INDEX IF NOT EXISTS idx_workspace_document_versions_ws_created
  ON workspace_document_versions (workspace_id, created_at DESC);

ALTER TABLE workspace_document_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_document_versions_select_member ON workspace_document_versions;
CREATE POLICY workspace_document_versions_select_member ON workspace_document_versions
  FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id, auth.uid()::text));

-- Mutations via service-role APIs only (optimistic concurrency + retention).
REVOKE ALL ON TABLE workspace_document_versions FROM anon, authenticated;
GRANT SELECT ON TABLE workspace_document_versions TO authenticated;

COMMENT ON TABLE workspace_document_versions IS
  'Phase 4: recovery snapshots for shared workspace_data saves. Retain latest N per workspace (app-enforced).';
