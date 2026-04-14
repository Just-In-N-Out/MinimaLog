-- Ensure comments are visible on all non-private posts without requiring a follow

BEGIN;

DROP POLICY IF EXISTS "Users can view comments on visible posts" ON public.comments;
DROP POLICY IF EXISTS "Users can view public comments" ON public.comments;

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
        COALESCE(posts.is_private, FALSE) = FALSE
        OR posts.user_id = auth.uid()
      )
  )
);

COMMIT;
