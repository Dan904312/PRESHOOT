-- ============================================
-- PRESHOOT PHASE 6 — HARDENING
-- product_events + storage ACL (deny client direct access)
-- Idempotent. Run in Supabase SQL Editor after Phase 5C.
-- ============================================

CREATE TABLE IF NOT EXISTS product_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text NOT NULL,
  event text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_events_user_created
  ON product_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_events_event_created
  ON product_events (event, created_at DESC);

ALTER TABLE product_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_events_select_own ON product_events;
CREATE POLICY product_events_select_own ON product_events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text);

REVOKE ALL ON TABLE product_events FROM anon, authenticated;
GRANT SELECT ON TABLE product_events TO authenticated;

COMMENT ON TABLE product_events IS
  'Phase 6: minimal product analytics. No scripts/conversations/media. Writes via service role APIs.';

-- Storage: deny authenticated clients direct access to production-assets.
-- Uploads remain via /api/upload (service role bypasses RLS).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'production-assets'
  ) THEN
    DROP POLICY IF EXISTS production_assets_no_client_select ON storage.objects;
    DROP POLICY IF EXISTS production_assets_no_client_insert ON storage.objects;
    DROP POLICY IF EXISTS production_assets_no_client_update ON storage.objects;
    DROP POLICY IF EXISTS production_assets_no_client_delete ON storage.objects;
    DROP POLICY IF EXISTS production_assets_restrict_select ON storage.objects;
    DROP POLICY IF EXISTS production_assets_restrict_insert ON storage.objects;
    DROP POLICY IF EXISTS production_assets_restrict_update ON storage.objects;
    DROP POLICY IF EXISTS production_assets_restrict_delete ON storage.objects;

    /* Restrictive: block production-assets for authenticated even if other policies allow */
    CREATE POLICY production_assets_restrict_select ON storage.objects
      AS RESTRICTIVE FOR SELECT TO authenticated
      USING (bucket_id IS DISTINCT FROM 'production-assets');

    CREATE POLICY production_assets_restrict_insert ON storage.objects
      AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (bucket_id IS DISTINCT FROM 'production-assets');

    CREATE POLICY production_assets_restrict_update ON storage.objects
      AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (bucket_id IS DISTINCT FROM 'production-assets');

    CREATE POLICY production_assets_restrict_delete ON storage.objects
      AS RESTRICTIVE FOR DELETE TO authenticated
      USING (bucket_id IS DISTINCT FROM 'production-assets');
  END IF;
END $$;
