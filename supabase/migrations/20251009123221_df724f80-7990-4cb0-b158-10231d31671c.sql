-- Add check constraint for alphanumeric usernames only
ALTER TABLE public.profiles 
ADD CONSTRAINT profiles_username_alphanumeric 
CHECK (username ~ '^[a-zA-Z0-9]+$');

ALTER TABLE public.public_profiles 
ADD CONSTRAINT public_profiles_username_alphanumeric 
CHECK (username ~ '^[a-zA-Z0-9]+$');

-- Update existing usernames to remove any non-alphanumeric characters
UPDATE public.profiles 
SET username = regexp_replace(username, '[^a-zA-Z0-9]', '', 'g')
WHERE username ~ '[^a-zA-Z0-9]';

UPDATE public.public_profiles 
SET username = regexp_replace(username, '[^a-zA-Z0-9]', '', 'g')
WHERE username ~ '[^a-zA-Z0-9]';

-- Recreate unique constraints to be case-sensitive (they already are by default in PostgreSQL)
-- Just verifying the constraints are in place
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'profiles_username_unique'
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_unique UNIQUE (username);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'public_profiles_username_unique'
  ) THEN
    ALTER TABLE public.public_profiles ADD CONSTRAINT public_profiles_username_unique UNIQUE (username);
  END IF;
END $$;