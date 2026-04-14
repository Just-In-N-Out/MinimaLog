-- Remove the policy that exposes all profile data to authenticated users
DROP POLICY IF EXISTS "Authenticated users can view limited profile info" ON public.profiles;

-- Create a secure view that only exposes public profile information (no email)
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT 
  id,
  name,
  created_at
FROM public.profiles;

-- Grant SELECT access on the view to authenticated users
GRANT SELECT ON public.public_profiles TO authenticated;

-- The existing "Users can view their own profile" policy remains for full profile access
-- This ensures users can only see email addresses for their own profile