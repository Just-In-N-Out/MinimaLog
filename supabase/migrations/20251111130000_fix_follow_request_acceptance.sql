-- Complete fix for follow request acceptance issue
-- This addresses TWO problems:
-- 1. Missing UPDATE policy on follows table
-- 2. Incorrect unique constraint allowing duplicates

BEGIN;

-- ============================================================================
-- PART 1: Add missing UPDATE policy for follows table
-- ============================================================================

-- Currently, users can INSERT and DELETE follows, but cannot UPDATE them!
-- This is why accepting follow requests (which updates status from pending to accepted) fails.

-- Drop any existing update policies
DROP POLICY IF EXISTS "Users can update their received follow requests" ON public.follows;
DROP POLICY IF EXISTS "Users can accept follow requests" ON public.follows;

-- Create UPDATE policy: Only the person being followed can update the status
-- This allows accepting/rejecting follow requests
CREATE POLICY "Users can update their received follow requests"
  ON public.follows
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = following_id)  -- Only if you're the one being followed
  WITH CHECK (auth.uid() = following_id);  -- And only update your own requests

-- ============================================================================
-- PART 2: Fix the unique constraint on follows table
-- ============================================================================

-- Step 1: Clean up duplicates - keep only 'accepted' status, or most recent if no accepted
WITH ranked_follows AS (
  SELECT
    id,
    follower_id,
    following_id,
    status,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY follower_id, following_id
      ORDER BY
        CASE WHEN status = 'accepted' THEN 0 ELSE 1 END,
        created_at DESC
    ) as rn
  FROM public.follows
)
DELETE FROM public.follows
WHERE id IN (
  SELECT id FROM ranked_follows WHERE rn > 1
);

-- Step 2: Drop the incorrect unique constraint
ALTER TABLE public.follows
  DROP CONSTRAINT IF EXISTS follows_follower_following_status_unique;

-- Step 3: Add the correct unique constraint (without status)
ALTER TABLE public.follows
  DROP CONSTRAINT IF EXISTS follows_follower_id_following_id_key;

ALTER TABLE public.follows
  ADD CONSTRAINT follows_follower_id_following_id_key
  UNIQUE (follower_id, following_id);

COMMIT;
