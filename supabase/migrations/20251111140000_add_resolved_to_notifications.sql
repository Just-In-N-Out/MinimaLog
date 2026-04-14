-- Add resolved column to notifications table to track if follow requests have been handled
ALTER TABLE notifications
ADD COLUMN resolved BOOLEAN DEFAULT false;

-- Add index for better query performance when filtering by resolved status
CREATE INDEX idx_notifications_resolved ON notifications(resolved);

-- Update existing follow_request notifications that have been processed
-- (where the follow record was deleted/declined or accepted)
UPDATE notifications n
SET resolved = true
WHERE n.type = 'follow_request'
AND n.read = true
AND NOT EXISTS (
  SELECT 1 FROM follows f
  WHERE f.follower_id = n.actor_id
  AND f.following_id = n.user_id
  AND f.status = 'pending'
);

COMMENT ON COLUMN notifications.resolved IS 'Indicates if a follow request notification has been accepted or declined by the user';
