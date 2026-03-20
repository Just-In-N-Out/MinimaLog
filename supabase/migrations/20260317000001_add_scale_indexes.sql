-- Indexes for 10K DAU scale
-- PR detection: called on every set addition during workouts
CREATE INDEX IF NOT EXISTS idx_prs_user_exercise
  ON public.prs(user_id, exercise_id);

-- Feed ordering
CREATE INDEX IF NOT EXISTS idx_posts_created_at
  ON public.posts(created_at DESC);

-- Like toggle: "did this user like this post?"
CREATE INDEX IF NOT EXISTS idx_likes_user_post
  ON public.likes(user_id, post_id);

-- Notifications: unread for user, sorted by date
CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created
  ON public.notifications(user_id, read, created_at DESC);

-- Comments: load comments for a post, sorted
CREATE INDEX IF NOT EXISTS idx_comments_post_created
  ON public.comments(post_id, created_at ASC);

-- Note: trigram search index for profiles.name skipped —
-- column may not exist in remote schema. Add manually if needed:
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX idx_profiles_name_trgm ON public.profiles USING gin(name gin_trgm_ops);
