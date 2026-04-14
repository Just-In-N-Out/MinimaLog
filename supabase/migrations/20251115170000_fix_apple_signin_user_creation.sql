-- Fix handle_new_user() to properly handle Apple Sign In and other OAuth providers
-- This migration adds:
-- 1. Proper username sanitization (alphanumeric only)
-- 2. Error handling with logging
-- 3. ON CONFLICT handling for user_roles
-- 4. Null/empty username fallback

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
    split_part(NEW.email, '@', 1),
    'user'
  );

  -- Sanitize username to be alphanumeric only (lowercase)
  -- Remove all non-alphanumeric characters
  base_username := regexp_replace(lower(base_username), '[^a-z0-9]', '', 'g');

  -- Fallback to 'user' if username is empty after sanitization
  IF base_username IS NULL OR base_username = '' THEN
    base_username := 'user';
  END IF;

  final_username := base_username;

  -- Get full name from metadata
  incoming_full_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), '')
  );

  -- Find unique username by appending counter if needed
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = final_username) LOOP
    counter := counter + 1;
    final_username := base_username || counter::text;
  END LOOP;

  -- Insert into profiles table
  INSERT INTO public.profiles (id, username, full_name, avatar_url, is_private)
  VALUES (NEW.id, final_username, COALESCE(incoming_full_name, ''), NULL, FALSE);

  -- Insert into public_profiles table
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
