-- Add private full_name storage for profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS full_name TEXT;

-- Ensure existing rows have a defined value
UPDATE public.profiles
SET full_name = COALESCE(full_name, '')
WHERE full_name IS NULL;

-- Update handle_new_user trigger to capture full_name from metadata
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

  INSERT INTO public.profiles (id, username, full_name)
  VALUES (NEW.id, final_username, COALESCE(incoming_full_name, ''));

  INSERT INTO public.public_profiles (id, username)
  VALUES (NEW.id, final_username);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'lifter');

  RETURN NEW;
END;
$$;
