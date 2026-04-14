-- Ensure new users have a sanitized username and capture their first name (e.g. from Apple sign-in)

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  raw_username TEXT;
  base_username TEXT;
  final_username TEXT;
  counter INTEGER := 1;
  first_name_candidate TEXT;
BEGIN
  raw_username := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'username'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'preferred_username'), ''),
    NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), '')
  );

  base_username := regexp_replace(lower(COALESCE(raw_username, 'user')), '[^a-z0-9]', '', 'g');

  IF base_username IS NULL OR base_username = '' THEN
    base_username := 'user';
  END IF;

  final_username := base_username;

  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = final_username) LOOP
    counter := counter + 1;
    final_username := base_username || counter::text;
  END LOOP;

  first_name_candidate := NULLIF(trim(NEW.raw_user_meta_data->>'first_name'), '');
  IF first_name_candidate IS NULL THEN
    first_name_candidate := NULLIF(trim(NEW.raw_user_meta_data->>'given_name'), '');
  END IF;
  IF first_name_candidate IS NULL THEN
    first_name_candidate := NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), '');
  END IF;
  IF first_name_candidate IS NULL THEN
    first_name_candidate := NULLIF(trim(NEW.raw_user_meta_data->>'name'), '');
  END IF;
  IF first_name_candidate IS NULL THEN
    first_name_candidate := NULLIF(trim(split_part(COALESCE(NEW.email, ''), '@', 1)), '');
  END IF;

  IF first_name_candidate IS NOT NULL THEN
    first_name_candidate := regexp_replace(first_name_candidate, '\s+.*$', '');
  ELSE
    first_name_candidate := '';
  END IF;

  INSERT INTO public.profiles (id, username, full_name)
  VALUES (NEW.id, final_username, first_name_candidate);

  INSERT INTO public.public_profiles (id, username)
  VALUES (NEW.id, final_username);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'lifter');

  RETURN NEW;
END;
$$;
