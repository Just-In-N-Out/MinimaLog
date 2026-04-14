-- Remove unused age verification columns now that signup no longer collects birth year
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS age_verified_16_plus;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS age_verified_16_plus_at;
