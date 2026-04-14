-- Add avatar_url column to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Add avatar_url column to public_profiles table
ALTER TABLE public.public_profiles
ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Create storage bucket for avatars
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view avatars" ON storage.objects;

-- Policy: Allow users to upload their own avatar
CREATE POLICY "Users can upload their own avatar"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Policy: Allow users to update their own avatar
CREATE POLICY "Users can update their own avatar"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Policy: Allow users to delete their own avatar
CREATE POLICY "Users can delete their own avatar"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Policy: Allow anyone to view avatars (public read)
CREATE POLICY "Anyone can view avatars"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'avatars');

-- Function to sync avatar_url between profiles and public_profiles
CREATE OR REPLACE FUNCTION public.sync_avatar_url()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- When avatar_url changes in profiles, update public_profiles
  IF NEW.avatar_url IS DISTINCT FROM OLD.avatar_url THEN
    UPDATE public.public_profiles
    SET avatar_url = NEW.avatar_url
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger to sync avatar_url automatically
DROP TRIGGER IF EXISTS sync_avatar_url_trigger ON public.profiles;
CREATE TRIGGER sync_avatar_url_trigger
AFTER UPDATE OF avatar_url ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_avatar_url();

-- Update handle_new_user to include avatar_url initialization
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  base_username TEXT;
  final_username TEXT;
  counter INTEGER := 1;
  incoming_full_name TEXT;
BEGIN
  -- Prefer explicit username from metadata, otherwise derive from email
  base_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1)
  );

  final_username := base_username;

  -- Capture name metadata for private storage
  incoming_full_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), '')
  );

  -- Ensure username uniqueness by appending a counter suffix if needed
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = final_username) LOOP
    counter := counter + 1;
    final_username := base_username || counter::text;
  END LOOP;

  INSERT INTO public.profiles (id, username, full_name, avatar_url)
  VALUES (NEW.id, final_username, COALESCE(incoming_full_name, ''), NULL);

  INSERT INTO public.public_profiles (id, username, avatar_url)
  VALUES (NEW.id, final_username, NULL);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'lifter');

  RETURN NEW;
END;
$$;
