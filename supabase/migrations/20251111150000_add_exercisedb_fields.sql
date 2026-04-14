-- Add ExerciseDB fields to exercises table
ALTER TABLE public.exercises
ADD COLUMN IF NOT EXISTS image_url TEXT,
ADD COLUMN IF NOT EXISTS exercisedb_id TEXT,
ADD COLUMN IF NOT EXISTS instructions TEXT[],
ADD COLUMN IF NOT EXISTS secondary_muscles TEXT[],
ADD COLUMN IF NOT EXISTS target_muscles TEXT[];

-- Create index on exercisedb_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_exercises_exercisedb_id ON public.exercises(exercisedb_id);

-- Create storage bucket for exercise images
INSERT INTO storage.buckets (id, name, public)
VALUES ('exercise-images', 'exercise-images', true)
ON CONFLICT (id) DO NOTHING;

-- Drop existing policies if they exist (to make migration idempotent)
DROP POLICY IF EXISTS "Public read access for exercise images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload exercise images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own exercise images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own exercise images" ON storage.objects;

-- Allow public read access to exercise images
CREATE POLICY "Public read access for exercise images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'exercise-images');

-- Allow authenticated users to upload exercise images (for custom exercises)
CREATE POLICY "Authenticated users can upload exercise images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'exercise-images');

-- Allow users to update their own exercise images
CREATE POLICY "Users can update their own exercise images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'exercise-images');

-- Allow users to delete their own exercise images
CREATE POLICY "Users can delete their own exercise images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'exercise-images');
