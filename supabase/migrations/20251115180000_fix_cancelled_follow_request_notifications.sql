-- Fix: Mark follow request notifications as resolved when follow requests are cancelled
-- When a user cancels a follow request (deletes the follow record),
-- the associated notification should be marked as resolved so it doesn't show up for the recipient

-- Drop the existing trigger first
DROP TRIGGER IF EXISTS handle_follow_notifications_trigger ON public.follows;

-- Update the function to handle DELETE operations
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
  ELSIF TG_OP = 'DELETE' THEN
    -- When a follow request is cancelled (record deleted), mark the notification as resolved
    UPDATE public.notifications
    SET resolved = true
    WHERE type = 'follow_request'
      AND user_id = OLD.following_id
      AND actor_id = OLD.follower_id
      AND resolved = false;

    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate the trigger to include DELETE operations
CREATE TRIGGER handle_follow_notifications_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.follows
FOR EACH ROW
EXECUTE FUNCTION public.handle_follow_notifications();
