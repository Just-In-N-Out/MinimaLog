-- Function to persist user height with schema cache resilient flow
create or replace function public.set_profile_height(
  user_id uuid,
  new_height_cm numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is distinct from user_id then
    raise exception using message = 'You can only update your own profile.';
  end if;

  update public.profiles
  set
    height_cm = new_height_cm,
    updated_at = now()
  where id = user_id;

  if not found then
    raise exception using message = 'Profile not found.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'public_profiles'
      and column_name = 'height_cm'
  ) then
    update public.public_profiles
    set height_cm = new_height_cm
    where id = user_id;
  end if;
end;
$$;

grant execute on function public.set_profile_height(uuid, numeric) to authenticated;
