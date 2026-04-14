-- Allow users to view PRs of people they follow and their own PRs
DROP POLICY IF EXISTS "Users can view their own PRs" ON public.prs;

CREATE POLICY "Users can view PRs of followed users and own"
ON public.prs
FOR SELECT
USING (
  auth.uid() = user_id OR
  EXISTS (
    SELECT 1 FROM public.follows
    WHERE follows.follower_id = auth.uid()
    AND follows.following_id = prs.user_id
  )
);