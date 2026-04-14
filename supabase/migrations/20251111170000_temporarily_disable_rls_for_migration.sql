-- Temporarily disable RLS on exercises table for migration
-- This allows the migration script to insert global exercises
-- RLS will be re-enabled after migration

ALTER TABLE public.exercises DISABLE ROW LEVEL SECURITY;

-- Note: Re-enable RLS after migration with:
-- ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;
