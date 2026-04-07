-- Allow re-applying for the same dates after a REJECTED decision.
-- We keep overlap prevention for PENDING/APPROVED.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='provider_leaves' AND column_name='status') THEN
    -- Drop old constraint if present.
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_leaves_overlap') THEN
      ALTER TABLE public.provider_leaves DROP CONSTRAINT provider_leaves_overlap;
    END IF;

    -- Add partial exclusion constraint (non-rejected only).
    -- Note: if your DB already has a similarly named constraint, drop it manually before running.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_leaves_overlap_active') THEN
      ALTER TABLE public.provider_leaves
      ADD CONSTRAINT provider_leaves_overlap_active EXCLUDE USING gist (
        provider_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&
      ) WHERE (status IS DISTINCT FROM 'REJECTED');
    END IF;
  END IF;
END $$;

