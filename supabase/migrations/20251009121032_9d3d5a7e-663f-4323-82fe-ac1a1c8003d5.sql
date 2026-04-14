-- Make PRs viewable by all authenticated users (public)
DROP POLICY IF EXISTS "Users can view PRs of followed users and own" ON public.prs;

CREATE POLICY "Authenticated users can view all PRs"
ON public.prs
FOR SELECT
USING (auth.uid() IS NOT NULL);