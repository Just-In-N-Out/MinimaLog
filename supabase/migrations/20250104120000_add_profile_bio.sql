-- Add bio fields for user profiles
alter table public.profiles
  add column if not exists bio text,
  add column if not exists height_cm numeric;

alter table public.public_profiles
  add column if not exists bio text,
  add column if not exists height_cm numeric;
