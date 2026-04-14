BEGIN;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;

DROP POLICY IF EXISTS "Users can view posts from people they follow and their own" ON public.posts;

CREATE POLICY "Users can view public posts or their own"
  ON public.posts
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR is_private = FALSE
  );

COMMIT;
