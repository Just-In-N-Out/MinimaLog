-- Ensure new users store only their first name in private profiles
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
  first_name_candidate TEXT;
BEGIN
  base_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1)
  );

  final_username := base_username;

  first_name_candidate := NULLIF(trim(NEW.raw_user_meta_data->>'first_name'), '');
  IF first_name_candidate IS NULL THEN
    first_name_candidate := NULLIF(trim(NEW.raw_user_meta_data->>'given_name'), '');
  END IF;
  IF first_name_candidate IS NULL THEN
    first_name_candidate := NULLIF(trim(split_part(COALESCE(NEW.raw_user_meta_data->>'full_name', ''), ' ', 1)), '');
  END IF;
  IF first_name_candidate IS NULL THEN
    first_name_candidate := NULLIF(trim(split_part(COALESCE(NEW.raw_user_meta_data->>'name', ''), ' ', 1)), '');
  END IF;

  incoming_full_name := COALESCE(first_name_candidate, '');

  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = final_username) LOOP
    counter := counter + 1;
    final_username := base_username || counter::text;
  END LOOP;

  INSERT INTO public.profiles (id, username, full_name)
  VALUES (NEW.id, final_username, incoming_full_name);

  INSERT INTO public.public_profiles (id, username)
  VALUES (NEW.id, final_username);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'lifter');

  RETURN NEW;
END;
$$;
