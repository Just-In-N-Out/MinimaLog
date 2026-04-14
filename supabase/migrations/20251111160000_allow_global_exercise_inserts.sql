-- Allow inserting global exercises (owner_user_id = NULL)
-- This is needed for the ExerciseDB migration script

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Allow service role to insert global exercises" ON exercises;

-- Create policy to allow inserting exercises with NULL owner_user_id
-- The service role key will be used by the migration script
CREATE POLICY "Allow service role to insert global exercises"
ON exercises
FOR INSERT
TO authenticated
WITH CHECK (owner_user_id IS NULL OR auth.uid() = owner_user_id);

-- Also ensure service role can delete for cleanup
DROP POLICY IF EXISTS "Allow service role to delete global exercises" ON exercises;

CREATE POLICY "Allow service role to delete global exercises"
ON exercises
FOR DELETE
TO authenticated
USING (owner_user_id IS NULL OR auth.uid() = owner_user_id);
