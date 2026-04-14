-- Fix critical security issues

-- 1. Create security definer function for role checking (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 2. Add restrictive policies to user_roles table
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;

CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Only system can manage roles"
ON public.user_roles
FOR ALL
TO authenticated
USING (false);

-- 3. Fix follows table RLS - restrict to only relevant users
DROP POLICY IF EXISTS "Authenticated users can view follows" ON public.follows;

CREATE POLICY "Users can view relevant follows"
ON public.follows
FOR SELECT
TO authenticated
USING (
  auth.uid() = follower_id OR 
  auth.uid() = following_id
);

-- 4. Fix exercises table - require authentication
DROP POLICY IF EXISTS "Users can view global and their own exercises" ON public.exercises;

CREATE POLICY "Authenticated users can view global and own exercises"
ON public.exercises
FOR SELECT
TO authenticated
USING (
  (owner_user_id IS NULL OR owner_user_id = auth.uid()) 
  AND auth.uid() IS NOT NULL
);

-- 5. Remove email column from profiles table (it's already in auth.users)
ALTER TABLE public.profiles DROP COLUMN IF EXISTS email;

-- 6. Update handle_new_user function to not insert email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert into profiles (no email - it's in auth.users)
  INSERT INTO public.profiles (id, name)
  VALUES (
    NEW.id,
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
$$;