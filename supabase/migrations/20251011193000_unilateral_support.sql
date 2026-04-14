BEGIN;

ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS is_unilateral BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS base_exercise_id UUID REFERENCES public.exercises(id) ON DELETE SET NULL;

ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS exercises_unilateral_requires_base,
  ADD CONSTRAINT exercises_unilateral_requires_base
    CHECK (is_unilateral = FALSE OR base_exercise_id IS NOT NULL);

ALTER TABLE public.sets
  ADD COLUMN IF NOT EXISTS is_unilateral BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS left_weight NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS left_reps INTEGER,
  ADD COLUMN IF NOT EXISTS left_rir INTEGER,
  ADD COLUMN IF NOT EXISTS left_notes TEXT,
  ADD COLUMN IF NOT EXISTS right_weight NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS right_reps INTEGER,
  ADD COLUMN IF NOT EXISTS right_rir INTEGER,
  ADD COLUMN IF NOT EXISTS right_notes TEXT;

COMMIT;
