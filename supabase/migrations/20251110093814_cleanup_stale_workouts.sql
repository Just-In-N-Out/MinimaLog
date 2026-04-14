-- Migration: Add function to cleanup stale workouts
-- Description: Automatically deletes workouts that have been active for more than 48 hours
-- This prevents "zombie" workouts from cluttering the database

-- Create function to cleanup workouts that have been active for more than 48 hours
CREATE OR REPLACE FUNCTION cleanup_stale_workouts()
RETURNS TABLE(deleted_workout_id UUID, started_at TIMESTAMPTZ) AS $$
BEGIN
  RETURN QUERY
  DELETE FROM public.workouts
  WHERE ended_at IS NULL
    AND started_at < NOW() - INTERVAL '48 hours'
    -- Don't delete workouts that have been posted
    AND id NOT IN (SELECT workout_id FROM public.posts WHERE workout_id IS NOT NULL)
  RETURNING id, started_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users (for edge function to call)
GRANT EXECUTE ON FUNCTION cleanup_stale_workouts() TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_stale_workouts() TO service_role;

-- Add comment for documentation
COMMENT ON FUNCTION cleanup_stale_workouts() IS 'Deletes workouts that have been active (ended_at IS NULL) for more than 48 hours, excluding workouts that have associated posts';
