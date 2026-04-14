-- Function to manually grant premium access to a user
-- Usage: SELECT grant_premium_access('user-uuid-here', '2026-12-31'::timestamptz);
-- For lifetime premium: SELECT grant_premium_access('user-uuid-here', NULL);

CREATE OR REPLACE FUNCTION public.grant_premium_access(
  target_user_id UUID,
  expires_at TIMESTAMPTZ DEFAULT NULL -- NULL = lifetime premium
)
RETURNS JSON AS $$
DECLARE
  result JSON;
  user_username TEXT;
BEGIN
  -- Check if user exists
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_user_id) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not found',
      'user_id', target_user_id
    );
  END IF;

  -- Get username for response (use username instead of email)
  SELECT username INTO user_username FROM public.profiles WHERE id = target_user_id;

  -- Grant premium access
  UPDATE public.profiles
  SET
    subscription_tier = 'premium',
    subscription_started_at = NOW(),
    subscription_expires_at = expires_at,
    last_subscription_check = NOW(),
    updated_at = NOW()
  WHERE id = target_user_id;

  -- Build success response
  result := json_build_object(
    'success', true,
    'user_id', target_user_id,
    'username', user_username,
    'subscription_tier', 'premium',
    'subscription_started_at', NOW(),
    'subscription_expires_at', COALESCE(expires_at::text, 'lifetime'),
    'message', CASE
      WHEN expires_at IS NULL THEN 'Lifetime premium access granted'
      ELSE 'Premium access granted until ' || expires_at::text
    END
  );

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users (you can restrict this further)
GRANT EXECUTE ON FUNCTION public.grant_premium_access(UUID, TIMESTAMPTZ) TO authenticated;

-- Function to revoke premium access
CREATE OR REPLACE FUNCTION public.revoke_premium_access(
  target_user_id UUID
)
RETURNS JSON AS $$
DECLARE
  result JSON;
  user_username TEXT;
BEGIN
  -- Check if user exists
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_user_id) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not found',
      'user_id', target_user_id
    );
  END IF;

  -- Get username for response
  SELECT username INTO user_username FROM public.profiles WHERE id = target_user_id;

  -- Revoke premium access
  UPDATE public.profiles
  SET
    subscription_tier = 'free',
    subscription_expires_at = NOW(), -- Expire immediately
    last_subscription_check = NOW(),
    updated_at = NOW()
  WHERE id = target_user_id;

  -- Build success response
  result := json_build_object(
    'success', true,
    'user_id', target_user_id,
    'username', user_username,
    'subscription_tier', 'free',
    'message', 'Premium access revoked'
  );

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.revoke_premium_access(UUID) TO authenticated;

-- Helper function to check user's current subscription status
CREATE OR REPLACE FUNCTION public.get_subscription_status(
  target_user_id UUID
)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'user_id', id,
    'username', username,
    'subscription_tier', subscription_tier,
    'is_premium', public.is_premium_user(id),
    'subscription_started_at', subscription_started_at,
    'subscription_expires_at', subscription_expires_at,
    'trial_started_at', trial_started_at,
    'trial_ends_at', trial_ends_at,
    'last_subscription_check', last_subscription_check
  ) INTO result
  FROM public.profiles
  WHERE id = target_user_id;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_subscription_status(UUID) TO authenticated;
