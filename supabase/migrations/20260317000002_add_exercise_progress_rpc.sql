-- Server-side aggregation for exercise progress
-- Replaces client-side fetching of all workout_exercises + sets (12K+ rows for power users)
-- Returns ~50 aggregated rows instead
CREATE OR REPLACE FUNCTION get_exercise_progress(p_user_id uuid)
RETURNS TABLE (
  exercise_id uuid,
  exercise_name text,
  equipment text,
  muscle_group text,
  total_sets bigint,
  max_weight numeric,
  unit text,
  last_workout timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    e.id AS exercise_id,
    e.name AS exercise_name,
    e.equipment,
    e.muscle_group,
    COUNT(s.id) AS total_sets,
    MAX(s.weight) AS max_weight,
    MODE() WITHIN GROUP (ORDER BY s.unit) AS unit,
    MAX(w.ended_at) AS last_workout
  FROM workout_exercises we
  JOIN exercises e ON e.id = we.exercise_id
  JOIN workouts w ON w.id = we.workout_id
  JOIN sets s ON s.workout_exercise_id = we.id AND s.is_warmup = false
  WHERE w.user_id = p_user_id AND w.ended_at IS NOT NULL
  GROUP BY e.id, e.name, e.equipment, e.muscle_group
  ORDER BY MAX(w.ended_at) DESC;
$$;
