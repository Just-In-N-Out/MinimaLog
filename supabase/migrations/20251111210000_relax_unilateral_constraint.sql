-- Temporarily relax unilateral constraint for ExerciseDB migration
-- ExerciseDB exercises don't have the base_exercise_id concept
-- We'll allow is_unilateral = TRUE without requiring base_exercise_id

ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS exercises_unilateral_requires_base;

-- Note: This allows standalone unilateral exercises from ExerciseDB
-- User-created exercise variants can still optionally set base_exercise_id
