-- Add privacy control to posts table
ALTER TABLE public.posts 
ADD COLUMN show_workout_details boolean NOT NULL DEFAULT true;

-- Comments visibility should be restricted to users who can see the post
-- Drop the current policy and create a more restrictive one
DROP POLICY IF EXISTS "Authenticated users can view comments" ON public.comments;

-- Allow viewing comments only on posts the user can see
CREATE POLICY "Users can view comments on visible posts"
ON public.comments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.posts
    WHERE posts.id = comments.post_id
    AND (
      posts.user_id = auth.uid() 
      OR EXISTS (
        SELECT 1 FROM public.follows
        WHERE follows.follower_id = auth.uid()
        AND follows.following_id = posts.user_id
      )
    )
  )
);