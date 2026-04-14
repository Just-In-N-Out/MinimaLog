-- Allow NULL usernames and remove 'user' default fallback
-- This allows users to have blank usernames initially and set them during onboarding
-- Also enforce case-insensitive uniqueness (Justin = justin)

-- Step 1: Remove NOT NULL constraint from username columns
ALTER TABLE public.profiles ALTER COLUMN username DROP NOT NULL;
ALTER TABLE public.public_profiles ALTER COLUMN username DROP NOT NULL;

-- Step 2: Drop existing unique constraints and create case-insensitive ones
-- Drop old constraints
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_username_unique;
ALTER TABLE public.public_profiles DROP CONSTRAINT IF EXISTS public_profiles_username_unique;

-- Create case-insensitive unique indexes (LOWER(username))
-- This ensures 'Justin' and 'justin' are treated as the same username
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_unique
ON public.profiles (LOWER(username))
WHERE username IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS public_profiles_username_lower_unique
ON public.public_profiles (LOWER(username))
WHERE username IS NOT NULL;

-- Step 2: Update handle_new_user() function to allow NULL usernames
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  base_username TEXT;
  final_username TEXT;
  counter INTEGER := 1;
  incoming_full_name TEXT;
BEGIN
  -- Get base username from metadata or email
  base_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1)
  );

  -- Sanitize username to be alphanumeric only (lowercase)
  -- Remove all non-alphanumeric characters
  IF base_username IS NOT NULL THEN
    base_username := regexp_replace(lower(base_username), '[^a-z0-9]', '', 'g');
  END IF;

  -- Set to NULL if username is empty after sanitization
  -- This allows users to set their own username during onboarding
  IF base_username IS NULL OR base_username = '' THEN
    base_username := NULL;
  END IF;

  final_username := base_username;

  -- Get full name from metadata
  incoming_full_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), '')
  );

  -- Only check for unique username if a username was provided
  -- If username is NULL, skip the uniqueness check
  IF final_username IS NOT NULL THEN
    -- Find unique username by appending counter if needed
    -- Use LOWER() for case-insensitive comparison (Justin = justin)
    WHILE EXISTS (SELECT 1 FROM public.profiles WHERE LOWER(username) = LOWER(final_username)) LOOP
      counter := counter + 1;
      final_username := base_username || counter::text;
    END LOOP;
  END IF;

  -- Insert into profiles table (username can be NULL)
  INSERT INTO public.profiles (id, username, full_name, avatar_url, is_private)
  VALUES (NEW.id, final_username, COALESCE(incoming_full_name, ''), NULL, FALSE);

  -- Insert into public_profiles table (username can be NULL)
  INSERT INTO public.public_profiles (id, username, avatar_url, is_private)
  VALUES (NEW.id, final_username, NULL, FALSE);

  -- Insert into user_roles table with conflict handling
  -- (in case of race conditions or retry scenarios)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'lifter')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    -- Log the specific unique constraint violation
    RAISE LOG 'Unique constraint violation creating user %: %. Username: %',
      NEW.id, SQLERRM, final_username;
    RAISE EXCEPTION 'Unable to create user profile: username conflict. Please try again.';
  WHEN foreign_key_violation THEN
    -- Log foreign key violations (shouldn't happen but good to catch)
    RAISE LOG 'Foreign key violation creating user %: %', NEW.id, SQLERRM;
    RAISE EXCEPTION 'Unable to create user profile: data integrity error.';
  WHEN check_violation THEN
    -- Log check constraint violations (e.g., username regex)
    RAISE LOG 'Check constraint violation creating user %: %. Username: %',
      NEW.id, SQLERRM, final_username;
    RAISE EXCEPTION 'Unable to create user profile: invalid data. Please try again.';
  WHEN OTHERS THEN
    -- Catch-all for any other errors
    RAISE LOG 'Unexpected error creating user %: %', NEW.id, SQLERRM;
    RAISE EXCEPTION 'Unable to create user profile: %. Please contact support.', SQLERRM;
END;
$$;
