ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS height_cm DECIMAL(10, 2);

ALTER TABLE public.public_profiles
  ADD COLUMN IF NOT EXISTS height_cm DECIMAL(10, 2);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'height_cm'
  ) THEN
    EXECUTE 'ALTER TABLE public.profiles ALTER COLUMN height_cm TYPE DECIMAL(10, 2)';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'public_profiles'
      AND column_name = 'height_cm'
  ) THEN
    EXECUTE 'ALTER TABLE public.public_profiles ALTER COLUMN height_cm TYPE DECIMAL(10, 2)';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_height_cm_non_negative'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_height_cm_non_negative
      CHECK (height_cm IS NULL OR height_cm >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'public_profiles_height_cm_non_negative'
      AND conrelid = 'public.public_profiles'::regclass
  ) THEN
    ALTER TABLE public.public_profiles
      ADD CONSTRAINT public_profiles_height_cm_non_negative
      CHECK (height_cm IS NULL OR height_cm >= 0);
  END IF;
END $$;
