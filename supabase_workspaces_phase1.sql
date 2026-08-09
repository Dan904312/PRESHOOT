-- ============================================
-- PRESHOOT COLLABORATIVE WORKSPACES — PHASE 1
-- Safe to run multiple times (idempotent).
-- Does NOT copy personal Studio JSON into workspace_data.
-- ============================================

-- ── Tables ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  slug text,
  owner_id text NOT NULL,
  kind text NOT NULL DEFAULT 'shared'
    CHECK (kind IN ('personal', 'shared')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_personal_owner
  ON workspaces (owner_id)
  WHERE kind = 'personal';

CREATE INDEX IF NOT EXISTS idx_workspaces_owner
  ON workspaces (owner_id);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL
    CHECK (role IN ('owner', 'editor', 'commenter', 'viewer')),
  invited_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user
  ON workspace_members (user_id);

CREATE TABLE IF NOT EXISTS workspace_data (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  document jsonb NOT NULL DEFAULT
    '{"version":3,"projects":[],"continueProductionId":null}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  revision bigint NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS workspace_invites (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL
    CHECK (role IN ('editor', 'commenter', 'viewer')),
  token_hash text NOT NULL UNIQUE,
  invited_by text NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_active
  ON workspace_invites (workspace_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_invites_email
  ON workspace_invites (lower(email));

-- ── Helper functions (SECURITY DEFINER, fixed search_path) ─

CREATE OR REPLACE FUNCTION is_workspace_member(p_workspace_id uuid, p_user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM workspace_members m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION workspace_role(p_workspace_id uuid, p_user_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.role
  FROM workspace_members m
  WHERE m.workspace_id = p_workspace_id
    AND m.user_id = p_user_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION can_edit_workspace(p_workspace_id uuid, p_user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM workspace_members m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = p_user_id
      AND m.role IN ('owner', 'editor')
  );
$$;

-- Idempotent personal workspace provisioner (metadata only — no document copy)
CREATE OR REPLACE FUNCTION ensure_personal_workspace(p_user_id text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RAISE EXCEPTION 'invalid_user';
  END IF;

  SELECT id INTO v_id
  FROM workspaces
  WHERE owner_id = p_user_id AND kind = 'personal'
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (v_id, p_user_id, 'owner')
    ON CONFLICT (workspace_id, user_id) DO NOTHING;
    RETURN v_id;
  END IF;

  INSERT INTO workspaces (name, owner_id, kind)
  VALUES ('Personal', p_user_id, 'personal')
  RETURNING id INTO v_id;

  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (v_id, p_user_id, 'owner')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  -- Intentionally NO workspace_data row for personal workspaces.
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION is_workspace_member(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION workspace_role(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION can_edit_workspace(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ensure_personal_workspace(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION is_workspace_member(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION workspace_role(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_edit_workspace(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION ensure_personal_workspace(text) TO service_role;

-- ── Personal backfill (metadata only) ──────────────────────

INSERT INTO workspaces (name, owner_id, kind)
SELECT 'Personal', src.user_id, 'personal'
FROM (
  SELECT user_id FROM users WHERE user_id IS NOT NULL AND length(trim(user_id)) > 0
  UNION
  SELECT user_id FROM user_data WHERE user_id IS NOT NULL AND length(trim(user_id)) > 0
) src
WHERE NOT EXISTS (
  SELECT 1 FROM workspaces w
  WHERE w.owner_id = src.user_id AND w.kind = 'personal'
);

INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT w.id, w.owner_id, 'owner'
FROM workspaces w
WHERE w.kind = 'personal'
  AND NOT EXISTS (
    SELECT 1 FROM workspace_members m
    WHERE m.workspace_id = w.id AND m.user_id = w.owner_id
  );

-- ── RLS ────────────────────────────────────────────────────

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspaces_select_member ON workspaces;
CREATE POLICY workspaces_select_member ON workspaces
  FOR SELECT TO authenticated
  USING (is_workspace_member(id, auth.uid()::text));

DROP POLICY IF EXISTS workspace_members_select_member ON workspace_members;
CREATE POLICY workspace_members_select_member ON workspace_members
  FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id, auth.uid()::text));

DROP POLICY IF EXISTS workspace_data_select_member ON workspace_data;
CREATE POLICY workspace_data_select_member ON workspace_data
  FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id, auth.uid()::text));

-- Mutations (including optimistic revision saves) are service-role API only.
-- Do not grant authenticated UPDATE — that would bypass /api/workspace-sync 409 checks.
DROP POLICY IF EXISTS workspace_data_update_editor ON workspace_data;

-- Invites (incl. token_hash) are never readable via PostgREST client JWT.
DROP POLICY IF EXISTS workspace_invites_select_owner ON workspace_invites;

-- No client INSERT/UPDATE/DELETE on workspaces/members/invites —
-- all mutations go through service-role APIs with membership checks.
REVOKE ALL ON TABLE workspaces FROM anon, authenticated;
REVOKE ALL ON TABLE workspace_members FROM anon, authenticated;
REVOKE ALL ON TABLE workspace_data FROM anon, authenticated;
REVOKE ALL ON TABLE workspace_invites FROM anon, authenticated;

GRANT SELECT ON TABLE workspaces TO authenticated;
GRANT SELECT ON TABLE workspace_members TO authenticated;
GRANT SELECT ON TABLE workspace_data TO authenticated;
-- workspace_invites: no authenticated SELECT (token_hash must not leak via RLS).

-- Storage note (shared Phase 1):
-- Shared uploads use path prefix workspaces/{workspace_id}/ via /api/upload (service role).
-- Personal uploads remain {user_id}/...
