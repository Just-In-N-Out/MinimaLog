BEGIN;

-- Create variant_type ENUM
CREATE TYPE public.variant_type AS ENUM ('bilateral', 'unilateral');

-- Add variant column to sets table
ALTER TABLE public.sets
  ADD COLUMN IF NOT EXISTS variant variant_type;

-- Backfill existing sets with variant based on is_unilateral
UPDATE public.sets
SET variant = CASE
  WHEN is_unilateral = TRUE THEN 'unilateral'::variant_type
  ELSE 'bilateral'::variant_type
END
WHERE variant IS NULL;

-- Make variant NOT NULL after backfill
ALTER TABLE public.sets
  ALTER COLUMN variant SET NOT NULL,
  ALTER COLUMN variant SET DEFAULT 'bilateral'::variant_type;

-- Add index for faster variant filtering (commonly used in history queries)
CREATE INDEX IF NOT EXISTS idx_sets_workout_exercise_variant
  ON public.sets(workout_exercise_id, variant);

-- Add index for history queries that filter by variant and created_at
CREATE INDEX IF NOT EXISTS idx_sets_variant_created_at
  ON public.sets(variant, created_at DESC);

COMMIT;
