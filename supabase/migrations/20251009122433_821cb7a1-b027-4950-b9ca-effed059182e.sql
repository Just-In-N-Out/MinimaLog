-- Step 1: Add temporary username column
ALTER TABLE public.profiles ADD COLUMN username TEXT;
ALTER TABLE public.public_profiles ADD COLUMN username TEXT;

-- Step 2: Migrate existing data from name to username
UPDATE public.profiles SET username = COALESCE(name, 'user');
UPDATE public.public_profiles SET username = COALESCE(name, 'user');

-- Step 3: Handle duplicates by adding sequential numbers
WITH ranked_profiles AS (
  SELECT 
    id,
    username,
    ROW_NUMBER() OVER (PARTITION BY username ORDER BY created_at) as rn
  FROM public.profiles
)
UPDATE public.profiles p
SET username = CASE 
  WHEN r.rn = 1 THEN r.username
  ELSE r.username || r.rn::text
END
FROM ranked_profiles r
WHERE p.id = r.id;

WITH ranked_public_profiles AS (
  SELECT 
    id,
    username,
    ROW_NUMBER() OVER (PARTITION BY username ORDER BY created_at) as rn
  FROM public.public_profiles
)
UPDATE public.public_profiles p
SET username = CASE 
  WHEN r.rn = 1 THEN r.username
  ELSE r.username || r.rn::text
END
FROM ranked_public_profiles r
WHERE p.id = r.id;

-- Step 4: Make username NOT NULL and add unique constraint
ALTER TABLE public.profiles ALTER COLUMN username SET NOT NULL;
ALTER TABLE public.public_profiles ALTER COLUMN username SET NOT NULL;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_unique UNIQUE (username);
ALTER TABLE public.public_profiles ADD CONSTRAINT public_profiles_username_unique UNIQUE (username);

-- Step 5: Drop old name columns
ALTER TABLE public.profiles DROP COLUMN name;
ALTER TABLE public.public_profiles DROP COLUMN name;

-- Step 6: Update the handle_new_user function to use username
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
BEGIN
  -- Get username from metadata or generate from email
  base_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1)
  );
  
  final_username := base_username;
  
  -- Check if username exists and add numbers if needed
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = final_username) LOOP
    counter := counter + 1;
    final_username := base_username || counter::text;
  END LOOP;
  
  -- Insert into profiles
  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, final_username);
  
  -- Insert into public_profiles
  INSERT INTO public.public_profiles (id, username)
  VALUES (NEW.id, final_username);
  
  -- Assign default lifter role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'lifter');
  
  RETURN NEW;
END;
$$;