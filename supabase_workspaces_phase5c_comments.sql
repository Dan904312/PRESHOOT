-- ============================================
-- PRESHOOT WORKSPACES PHASE 5C — COMMENTS / MENTIONS / NOTIFICATIONS
-- Idempotent. Comments are collaborative metadata — NOT Studio JSON.
-- Does NOT modify user_data or normalize Studio entities.
-- ============================================

CREATE TABLE IF NOT EXISTS workspace_comments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author_id text NOT NULL,
  target_type text NOT NULL
    CHECK (target_type IN ('project', 'production', 'script', 'shot', 'reference', 'asset')),
  target_id text NOT NULL,
  project_id text,
  production_id text,
  parent_id uuid REFERENCES workspace_comments(id) ON DELETE CASCADE,
  body text NOT NULL,
  mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_workspace_comments_ws_created
  ON workspace_comments (workspace_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_comments_ws_target
  ON workspace_comments (workspace_id, target_type, target_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_comments_ws_production
  ON workspace_comments (workspace_id, production_id, resolved)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_comments_parent
  ON workspace_comments (parent_id)
  WHERE deleted_at IS NULL;

ALTER TABLE workspace_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_comments_select_member ON workspace_comments;
CREATE POLICY workspace_comments_select_member ON workspace_comments
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND is_workspace_member(workspace_id, auth.uid()::text)
  );

REVOKE ALL ON TABLE workspace_comments FROM anon, authenticated;
GRANT SELECT ON TABLE workspace_comments TO authenticated;

CREATE TABLE IF NOT EXISTS workspace_notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  type text NOT NULL
    CHECK (type IN (
      'mention',
      'comment_reply',
      'comment_resolved',
      'thread_reply'
    )),
  comment_id uuid REFERENCES workspace_comments(id) ON DELETE SET NULL,
  actor_id text,
  title text NOT NULL,
  body text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_notifications_user_created
  ON workspace_notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_notifications_ws_user
  ON workspace_notifications (workspace_id, user_id, created_at DESC);

ALTER TABLE workspace_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_notifications_select_own ON workspace_notifications;
CREATE POLICY workspace_notifications_select_own ON workspace_notifications
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()::text
    AND is_workspace_member(workspace_id, auth.uid()::text)
  );

REVOKE ALL ON TABLE workspace_notifications FROM anon, authenticated;
GRANT SELECT ON TABLE workspace_notifications TO authenticated;

COMMENT ON TABLE workspace_comments IS
  'Phase 5C: workspace-scoped comments. Separate from workspace_data.document.';
COMMENT ON TABLE workspace_notifications IS
  'Phase 5C: per-user mention/reply notifications. Workspace-scoped.';
