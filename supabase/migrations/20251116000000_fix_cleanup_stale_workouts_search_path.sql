-- Fix: Add missing SET search_path to cleanup_stale_workouts function
-- Security Issue: Without explicit search_path, this function is vulnerable to
-- search path manipulation attacks where an attacker could create a malicious
-- 'workouts' table in their own schema and trick the function into operating on it.

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
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public; -- SECURITY FIX: Explicitly set search_path

-- Add comment documenting the security fix
COMMENT ON FUNCTION cleanup_stale_workouts() IS 'Deletes workouts that have been active (ended_at IS NULL) for more than 48 hours, excluding workouts that have associated posts. SECURITY: Function uses explicit search_path to prevent search path manipulation attacks.';
