/* ============================================
   PRESHOOT — users.account_status
   Additive. Safe to run more than once.
   Required for Admin Suspend / Restore.
   Live PRESHOOT already has these columns as of
   2026-09-04 inspect.
   Also included in supabase_admin_console.sql
   and supabase_setup.sql.
   ============================================ */

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS account_status_reason text,
  ADD COLUMN IF NOT EXISTS account_status_at timestamptz,
  ADD COLUMN IF NOT EXISTS account_status_by text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_account_status_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_account_status_check
      CHECK (account_status IN ('active', 'suspended'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_account_status ON users (account_status);
