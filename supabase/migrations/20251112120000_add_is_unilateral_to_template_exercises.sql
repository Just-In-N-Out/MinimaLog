-- Add is_unilateral column to template_exercises table
ALTER TABLE template_exercises
ADD COLUMN is_unilateral BOOLEAN DEFAULT false;

-- Add comment to document the column
COMMENT ON COLUMN template_exercises.is_unilateral IS 'Whether this exercise should be tracked unilaterally (left/right separately) in workouts started from this template';
