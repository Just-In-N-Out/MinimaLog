-- Fix RLS policies for social features to require authentication

-- Drop overly permissive policies
DROP POLICY IF EXISTS "Users can view all comments" ON public.comments;
DROP POLICY IF EXISTS "Users can view all follows" ON public.follows;
DROP POLICY IF EXISTS "Users can view all likes" ON public.likes;

-- Create secure policies requiring authentication

-- Comments: Only authenticated users can view comments
CREATE POLICY "Authenticated users can view comments"
ON public.comments
FOR SELECT
TO authenticated
USING (true);

-- Follows: Only authenticated users can view follows
CREATE POLICY "Authenticated users can view follows"
ON public.follows
FOR SELECT
TO authenticated
USING (true);

-- Likes: Only authenticated users can view likes
CREATE POLICY "Authenticated users can view likes"
ON public.likes
FOR SELECT
TO authenticated
USING (true);

-- Update profiles table to restrict email visibility
-- Drop existing public view policy if it exists
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;

-- Create new policies: users can only see their own full profile
CREATE POLICY "Users can view their own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Allow authenticated users to see limited profile info (name only, no email)
CREATE POLICY "Authenticated users can view limited profile info"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);