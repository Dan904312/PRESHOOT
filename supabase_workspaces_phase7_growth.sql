-- Phase 7: Growth / product intelligence schema helpers
-- product_events already created in Phase 6. This adds optional content_performance
-- for a future feedback loop (user-supplied metrics only — no scraping).

-- Ensure product_events exists (idempotent pointer; Phase 6 owns base table)
-- CREATE TABLE IF NOT EXISTS product_events (...); -- see supabase_workspaces_phase6_hardening.sql

CREATE TABLE IF NOT EXISTS content_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  production_id text,
  workspace_id uuid,
  platform text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_performance_user_idx
  ON content_performance (user_id, created_at DESC);

ALTER TABLE content_performance ENABLE ROW LEVEL SECURITY;

-- Service role writes via API; no direct client policies for cross-user reads.
-- Users must never query another user's performance rows.
DROP POLICY IF EXISTS content_performance_owner_select ON content_performance;
CREATE POLICY content_performance_owner_select ON content_performance
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS content_performance_owner_insert ON content_performance;
CREATE POLICY content_performance_owner_insert ON content_performance
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS content_performance_owner_update ON content_performance;
CREATE POLICY content_performance_owner_update ON content_performance
  FOR UPDATE USING (auth.uid() = user_id);

COMMENT ON TABLE content_performance IS
  'Phase 7 boundary for user-supplied content metrics (views/likes/etc). No fabricated or scraped data.';
