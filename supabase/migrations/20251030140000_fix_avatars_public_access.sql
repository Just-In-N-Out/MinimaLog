-- Fix avatars bucket to be truly public for viewing
-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Anyone can view avatars" ON storage.objects;

-- Create a new policy that allows public viewing (no authentication required)
CREATE POLICY "Public can view avatars"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'avatars');
