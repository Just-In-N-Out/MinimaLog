-- Function to decrement workout count when a workout is deleted
CREATE OR REPLACE FUNCTION public.decrement_workout_count()
RETURNS TRIGGER AS $$
DECLARE
  workout_month TEXT;
BEGIN
  -- Get the month the workout was created in
  workout_month := TO_CHAR(OLD.started_at, 'YYYY-MM');

  -- Decrement the count for that month
  UPDATE public.monthly_usage
  SET
    workout_count = GREATEST(workout_count - 1, 0),  -- Don't go below 0
    updated_at = NOW()
  WHERE user_id = OLD.user_id
    AND month_year = workout_month;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to decrement count on workout deletion
CREATE TRIGGER decrement_workout_usage
  AFTER DELETE ON public.workouts
  FOR EACH ROW
  EXECUTE FUNCTION public.decrement_workout_count();
