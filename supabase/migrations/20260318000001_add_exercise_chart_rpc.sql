-- Server-side aggregation for exercise chart data
-- Replaces loading ALL workout_exercises + ALL sets for one exercise
-- Returns one aggregated row per workout date
CREATE OR REPLACE FUNCTION get_exercise_chart_data(p_user_id uuid, p_exercise_id uuid)
RETURNS TABLE (
  workout_date timestamptz,
  max_weight numeric,
  max_reps int,
  volume numeric
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    w.started_at AS workout_date,
    MAX(s.weight)::numeric AS max_weight,
    MAX(s.reps)::int AS max_reps,
    SUM(s.weight * s.reps)::numeric AS volume
  FROM workout_exercises we
  JOIN workouts w ON w.id = we.workout_id
  JOIN sets s ON s.workout_exercise_id = we.id AND s.is_warmup = false
  WHERE we.exercise_id = p_exercise_id
    AND w.user_id = p_user_id
    AND w.ended_at IS NOT NULL
  GROUP BY w.id, w.started_at
  ORDER BY w.started_at ASC;
$$;
