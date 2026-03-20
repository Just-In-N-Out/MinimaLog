-- Follow-filtered feed with aggregated likes and workout summaries
-- Replaces: global posts query + batch likes query + batch workout_exercises query
-- Returns everything in one call with counts instead of raw rows
CREATE OR REPLACE FUNCTION get_feed(p_user_id uuid, p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  workout_id uuid,
  title text,
  caption text,
  created_at timestamptz,
  show_workout_details boolean,
  like_count bigint,
  liked_by_me boolean,
  exercise_count bigint,
  set_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    p.id,
    p.user_id,
    p.workout_id,
    p.title,
    p.caption,
    p.created_at,
    p.show_workout_details,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
    EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = p_user_id) AS liked_by_me,
    (SELECT COUNT(*) FROM workout_exercises we WHERE we.workout_id = p.workout_id) AS exercise_count,
    (SELECT COUNT(*) FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id WHERE we.workout_id = p.workout_id) AS set_count
  FROM posts p
  WHERE p.user_id = p_user_id
     OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = p_user_id)
  ORDER BY p.created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;
