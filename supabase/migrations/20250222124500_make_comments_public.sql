-- Make comments visible on all non-private posts

DROP POLICY IF EXISTS "Users can view comments on visible posts" ON public.comments;

CREATE POLICY "Users can view public comments"
ON public.comments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.posts
    WHERE posts.id = comments.post_id
      AND (
        posts.is_private = false
        OR posts.user_id = auth.uid()
      )
  )
);
