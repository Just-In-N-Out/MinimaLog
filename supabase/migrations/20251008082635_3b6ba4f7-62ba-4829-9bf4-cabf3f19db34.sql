-- Fix Critical Security Issues

-- 1. Drop the insecure public_profiles view
DROP VIEW IF EXISTS public.public_profiles;

-- 2. Create a secure public_profiles table (no email, only public info)
CREATE TABLE IF NOT EXISTS public.public_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  created_at timestamp with time zone DEFAULT now()
);

-- 3. Enable RLS on public_profiles
ALTER TABLE public.public_profiles ENABLE ROW LEVEL SECURITY;

-- 4. Add RLS policy for public_profiles (read-only for authenticated users)
CREATE POLICY "Authenticated users can view public profiles"
ON public.public_profiles
FOR SELECT
TO authenticated
USING (true);

-- 5. Only profile owners can update their public profile
CREATE POLICY "Users can update their own public profile"
ON public.public_profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id);

-- 6. Prevent any inserts or deletes (managed by trigger only)
CREATE POLICY "No direct inserts"
ON public.public_profiles
FOR INSERT
TO authenticated
WITH CHECK (false);

CREATE POLICY "No direct deletes"
ON public.public_profiles
FOR DELETE
TO authenticated
USING (false);

-- 7. Update the handle_new_user trigger to populate both tables
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- Insert into profiles (includes email - private)
  INSERT INTO public.profiles (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', '')
  );
  
  -- Insert into public_profiles (no email - public to authenticated users)
  INSERT INTO public.public_profiles (id, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', '')
  );
  
  -- Assign default lifter role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'lifter');
  
  RETURN NEW;
END;
$function$;

-- 8. Backfill existing users into public_profiles
INSERT INTO public.public_profiles (id, name, created_at)
SELECT id, name, created_at 
FROM public.profiles
ON CONFLICT (id) DO NOTHING;

-- 9. Strengthen coaches table RLS - prevent unauthenticated access
DROP POLICY IF EXISTS "Users can view their coach relationships" ON public.coaches;
CREATE POLICY "Users can view their coach relationships"
ON public.coaches
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR auth.uid() = coach_user_id);

-- 10. Add explicit policy to prevent public access to coaches
CREATE POLICY "Prevent anonymous access to coaches"
ON public.coaches
FOR SELECT
TO anon
USING (false);