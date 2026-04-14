BEGIN;

-- 1. Add account-level privacy toggle to profiles tables
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.public_profiles
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Keep public_profiles.is_private in sync with profiles.is_private
CREATE OR REPLACE FUNCTION public.sync_profile_privacy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF NEW.is_private IS DISTINCT FROM OLD.is_private THEN
    UPDATE public.public_profiles
    SET is_private = NEW.is_private
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_profile_privacy_trigger ON public.profiles;
CREATE TRIGGER sync_profile_privacy_trigger
AFTER UPDATE OF is_private ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_privacy();

-- 3. Ensure new users start with public profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  base_username TEXT;
  final_username TEXT;
  counter INTEGER := 1;
  incoming_full_name TEXT;
BEGIN
  base_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1)
  );

  final_username := base_username;

  incoming_full_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), '')
  );

  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = final_username) LOOP
    counter := counter + 1;
    final_username := base_username || counter::text;
  END LOOP;

  INSERT INTO public.profiles (id, username, full_name, avatar_url, is_private)
  VALUES (NEW.id, final_username, COALESCE(incoming_full_name, ''), NULL, FALSE);

  INSERT INTO public.public_profiles (id, username, avatar_url, is_private)
  VALUES (NEW.id, final_username, NULL, FALSE);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'lifter');

  RETURN NEW;
END;
$$;

-- 4. Follow status enum + column
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'follow_status') THEN
    CREATE TYPE public.follow_status AS ENUM ('pending', 'accepted', 'rejected');
  END IF;
END;
$$;

ALTER TABLE public.follows
  ADD COLUMN IF NOT EXISTS status public.follow_status NOT NULL DEFAULT 'accepted';

ALTER TABLE public.follows
  DROP CONSTRAINT IF EXISTS follows_follower_id_following_id_key;

ALTER TABLE public.follows
  ADD CONSTRAINT follows_follower_following_status_unique
  UNIQUE (follower_id, following_id, status);

-- 5. Helper function to check accepted follow relationships
CREATE OR REPLACE FUNCTION public.is_follow_accepted(_follower_id UUID, _following_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT
    CASE
      WHEN _follower_id IS NULL OR _following_id IS NULL THEN FALSE
      ELSE EXISTS (
        SELECT 1
        FROM public.follows f
        WHERE f.follower_id = _follower_id
          AND f.following_id = _following_id
          AND f.status = 'accepted'
      )
    END;
$$;

-- 6. Update posts RLS to respect account privacy
DROP POLICY IF EXISTS "Users can view public posts or their own" ON public.posts;

CREATE POLICY "Users can view posts respecting account privacy"
  ON public.posts
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR (
      posts.is_private = FALSE
      AND (
        NOT COALESCE(
          (SELECT is_private FROM public.profiles p WHERE p.id = posts.user_id),
          FALSE
        )
        OR public.is_follow_accepted(auth.uid(), posts.user_id)
      )
    )
  );

-- 7. Update follows SELECT policy so pending requests stay private
DROP POLICY IF EXISTS "Authenticated users can view all follows" ON public.follows;

CREATE POLICY "Users can view follows they are allowed to see"
  ON public.follows
  FOR SELECT
  TO authenticated
  USING (
    status = 'accepted'
    OR auth.uid() = follower_id
    OR auth.uid() = following_id
  );

-- 8. Extend notification types with follow request lifecycle
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (
    type IN ('like', 'comment', 'follow', 'follow_request', 'follow_accepted')
  );

-- 9. Replace follow notification trigger to emit request + acceptance events
DROP TRIGGER IF EXISTS on_follow_created ON public.follows;
DROP FUNCTION IF EXISTS public.create_follow_notification();

CREATE OR REPLACE FUNCTION public.handle_follow_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'pending' THEN
      INSERT INTO public.notifications (user_id, type, actor_id)
      VALUES (NEW.following_id, 'follow_request', NEW.follower_id);
    ELSIF NEW.status = 'accepted' THEN
      INSERT INTO public.notifications (user_id, type, actor_id)
      VALUES (NEW.following_id, 'follow', NEW.follower_id);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
      INSERT INTO public.notifications (user_id, type, actor_id)
      VALUES (NEW.following_id, 'follow', NEW.follower_id);

      INSERT INTO public.notifications (user_id, type, actor_id)
      VALUES (NEW.follower_id, 'follow_accepted', NEW.following_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER handle_follow_notifications_trigger
AFTER INSERT OR UPDATE ON public.follows
FOR EACH ROW
EXECUTE FUNCTION public.handle_follow_notifications();

-- 10. Automatically set follow status based on target privacy
CREATE OR REPLACE FUNCTION public.apply_follow_privacy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  target_private BOOLEAN;
BEGIN
  SELECT is_private INTO target_private
  FROM public.profiles
  WHERE id = NEW.following_id;

  IF COALESCE(target_private, FALSE) THEN
    NEW.status := 'pending';
  ELSE
    NEW.status := 'accepted';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_follow_privacy_trigger ON public.follows;
CREATE TRIGGER apply_follow_privacy_trigger
BEFORE INSERT ON public.follows
FOR EACH ROW
EXECUTE FUNCTION public.apply_follow_privacy();

COMMIT;
