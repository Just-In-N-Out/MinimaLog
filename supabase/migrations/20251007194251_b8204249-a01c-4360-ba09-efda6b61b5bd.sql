-- Drop and recreate the view with SECURITY INVOKER to fix the security warning
DROP VIEW IF EXISTS public.public_profiles;

-- Create view with SECURITY INVOKER (enforces querying user's permissions, not creator's)
CREATE VIEW public.public_profiles
WITH (security_invoker=true)
AS
SELECT 
  id,
  name,
  created_at
FROM public.profiles;

-- Grant SELECT access on the view to authenticated users
GRANT SELECT ON public.public_profiles TO authenticated;