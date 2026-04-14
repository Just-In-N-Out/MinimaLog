-- Create function to delete user account and all associated data
CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_avatar_path TEXT;
BEGIN
  -- Get the current user's ID
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get avatar path before deleting profile (if exists)
  SELECT avatar_url INTO v_avatar_path
  FROM public.profiles
  WHERE id = v_user_id;

  -- Delete avatar from storage if it exists
  IF v_avatar_path IS NOT NULL THEN
    -- Extract the file path from the full URL
    -- avatar_url format: https://<project>.supabase.co/storage/v1/object/public/avatars/<user_id>/<filename>
    -- We need just the part after /avatars/
    DELETE FROM storage.objects
    WHERE bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = v_user_id::TEXT;
  END IF;

  -- Delete AI usage tracking
  DELETE FROM public.ai_usage_tracking WHERE user_id = v_user_id;

  -- Delete AI suggestions
  DELETE FROM public.ai_suggestions WHERE user_id = v_user_id;

  -- Delete follows (both as follower and following)
  DELETE FROM public.follows WHERE follower_id = v_user_id OR following_id = v_user_id;

  -- Delete likes
  DELETE FROM public.likes WHERE user_id = v_user_id;

  -- Delete comments
  DELETE FROM public.comments WHERE user_id = v_user_id;

  -- Delete posts (this will cascade delete likes and comments on those posts)
  DELETE FROM public.posts WHERE user_id = v_user_id;

  -- Delete PRs
  DELETE FROM public.prs WHERE user_id = v_user_id;

  -- Delete unit overrides
  DELETE FROM public.unit_overrides WHERE user_id = v_user_id;

  -- Delete user roles
  DELETE FROM public.user_roles WHERE user_id = v_user_id;

  -- Delete coach relationships (both as user and as coach)
  DELETE FROM public.coaches WHERE user_id = v_user_id OR coach_user_id = v_user_id;

  -- Delete workouts (this will CASCADE delete workout_groups, workout_exercises, sets, session_metrics)
  DELETE FROM public.workouts WHERE user_id = v_user_id;

  -- Delete custom exercises created by user
  DELETE FROM public.exercises WHERE owner_user_id = v_user_id;

  -- Delete profile (this will CASCADE to auth.users due to the FK relationship)
  DELETE FROM public.profiles WHERE id = v_user_id;

  -- Delete auth user (admin/service role required for this)
  -- Note: This requires service_role permissions
  DELETE FROM auth.users WHERE id = v_user_id;

END;
$$;

-- Grant execute permission to authenticated users (they can only delete their own account due to auth.uid() check)
GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION public.delete_user_account() IS 'Permanently deletes the authenticated user''s account and all associated data including workouts, posts, follows, and uploaded images. This action cannot be undone.';
