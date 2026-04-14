-- Update handle_new_user trigger to sanitize usernames and avoid duplicate insert errors
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_username TEXT;
  normalized_username TEXT;
  final_username TEXT;
  counter INTEGER := 1;
BEGIN
  base_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    NEW.raw_user_meta_data->>'preferred_username',
    split_part(NEW.email, '@', 1)
  );

  normalized_username := regexp_replace(lower(COALESCE(base_username, 'user')), '[^a-z0-9]', '', 'g');

  IF normalized_username IS NULL OR normalized_username = '' THEN
    normalized_username := 'user';
  END IF;

  final_username := normalized_username;

  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = final_username) LOOP
    counter := counter + 1;
    final_username := normalized_username || counter::text;
  END LOOP;

  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, final_username);

  INSERT INTO public.public_profiles (id, username)
  VALUES (NEW.id, final_username);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'lifter')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;
