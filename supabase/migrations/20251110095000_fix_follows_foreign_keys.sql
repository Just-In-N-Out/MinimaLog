-- Fix followers/following display by adding foreign key constraints and updating RLS policy

-- Add foreign key constraints to enable PostgREST embedded resources
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'follows_follower_fkey'
      AND conrelid = 'public.follows'::regclass
  ) THEN
    ALTER TABLE follows
      ADD CONSTRAINT follows_follower_fkey
      FOREIGN KEY (follower_id)
      REFERENCES public_profiles(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'follows_following_fkey'
      AND conrelid = 'public.follows'::regclass
  ) THEN
    ALTER TABLE follows
      ADD CONSTRAINT follows_following_fkey
      FOREIGN KEY (following_id)
      REFERENCES public_profiles(id) ON DELETE CASCADE;
  END IF;
END;
$$;

-- Update RLS policy to respect privacy settings
-- Only show accepted follows publicly, but allow users to see their own pending requests
DROP POLICY IF EXISTS "Users can view relevant follows" ON public.follows;
DROP POLICY IF EXISTS "Authenticated users can view all follows" ON public.follows;
DROP POLICY IF EXISTS "Users can view follows they are allowed to see" ON public.follows;

CREATE POLICY "Users can view follows they are allowed to see"
  ON public.follows
  FOR SELECT
  TO authenticated
  USING (
    status = 'accepted'
    OR auth.uid() = follower_id
    OR auth.uid() = following_id
  );

-- Keep the existing insert and delete policies intact
-- These ensure users can only follow/unfollow as themselves
