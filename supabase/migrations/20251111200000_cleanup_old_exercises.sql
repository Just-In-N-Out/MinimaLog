-- Clean up old exercises and all their dependencies
-- This removes all CSV-based exercises to make room for fresh ExerciseDB import

-- Delete all template_exercises that reference old exercises
DELETE FROM public.template_exercises
WHERE exercise_id IN (
  SELECT id FROM public.exercises WHERE exercisedb_id IS NULL
);

-- Delete all workout_exercises that reference old exercises
DELETE FROM public.workout_exercises
WHERE exercise_id IN (
  SELECT id FROM public.exercises WHERE exercisedb_id IS NULL
);

-- Delete the old exercises themselves
DELETE FROM public.exercises WHERE exercisedb_id IS NULL;
