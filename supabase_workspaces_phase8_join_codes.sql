/* ============================================
   PRESHOOT — 6-digit workspace join codes
   Additive. Safe to run more than once.
   Stores only a HMAC hash — never the plaintext code.
   ============================================ */

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS join_code_hash text,
  ADD COLUMN IF NOT EXISTS join_code_role text NOT NULL DEFAULT 'editor',
  ADD COLUMN IF NOT EXISTS join_code_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS join_code_generated_by text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspaces_join_code_role_check'
  ) THEN
    ALTER TABLE workspaces
      ADD CONSTRAINT workspaces_join_code_role_check
      CHECK (join_code_role IN ('editor', 'commenter', 'viewer'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_join_code_hash
  ON workspaces (join_code_hash)
  WHERE join_code_hash IS NOT NULL;
