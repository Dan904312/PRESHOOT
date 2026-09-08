-- sql/users_account_status.sql
-- PreShoot: account suspension columns on public.users
-- Safe to re-run. Run in Supabase SQL Editor.
-- Does not DELETE or UPDATE existing user rows.
-- Service-role continues to manage rows. Do not grant anon write.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS account_status_reason text,
  ADD COLUMN IF NOT EXISTS account_status_at timestamptz,
  ADD COLUMN IF NOT EXISTS account_status_by text;

DO $$ BEGIN
  ALTER TABLE public.users
    ADD CONSTRAINT users_account_status_check
    CHECK (account_status IN ('active', 'suspended'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_account_status
  ON public.users (account_status);

CREATE INDEX IF NOT EXISTS idx_users_account_status_at
  ON public.users (account_status_at DESC NULLS LAST)
  WHERE account_status = 'suspended';

COMMENT ON COLUMN public.users.account_status IS
  'active|suspended — enforced by requireActiveUser / setAccountStatus';
