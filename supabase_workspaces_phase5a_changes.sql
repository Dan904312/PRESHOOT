-- ============================================
-- PRESHOOT WORKSPACES PHASE 5A — CHANGE METADATA
-- Idempotent. Does NOT normalize Studio entities.
-- workspace_data.document remains authoritative.
-- ============================================

ALTER TABLE workspace_document_versions
  ADD COLUMN IF NOT EXISTS change_type text;

ALTER TABLE workspace_document_versions
  ADD COLUMN IF NOT EXISTS entity_id text;

ALTER TABLE workspace_document_versions
  ADD COLUMN IF NOT EXISTS entity_label text;

ALTER TABLE workspace_document_versions
  ADD COLUMN IF NOT EXISTS project_id text;

ALTER TABLE workspace_document_versions
  ADD COLUMN IF NOT EXISTS production_id text;

ALTER TABLE workspace_document_versions
  ADD COLUMN IF NOT EXISTS changes jsonb NOT NULL DEFAULT '[]'::jsonb;

/* Soft check — allow NULL for legacy rows; new rows use known types via app */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspace_document_versions_change_type_check'
  ) THEN
    ALTER TABLE workspace_document_versions
      ADD CONSTRAINT workspace_document_versions_change_type_check
      CHECK (
        change_type IS NULL OR change_type IN (
          'project.created',
          'project.updated',
          'project.deleted',
          'production.created',
          'production.updated',
          'production.deleted',
          'script.updated',
          'shotlist.updated',
          'references.updated',
          'assets.updated',
          'workspace.restored',
          'workspace.updated'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workspace_document_versions_ws_change
  ON workspace_document_versions (workspace_id, change_type, created_at DESC);

COMMENT ON COLUMN workspace_document_versions.change_type IS
  'Phase 5A primary change type for this successful save/restore snapshot.';
COMMENT ON COLUMN workspace_document_versions.changes IS
  'Phase 5A compact array of detected entity changes (no full document copies).';
