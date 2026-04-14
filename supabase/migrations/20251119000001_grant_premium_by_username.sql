-- Function to grant premium access using username instead of UUID
-- Usage: SELECT grant_premium_by_username('johndoe', NULL);

CREATE OR REPLACE FUNCTION public.grant_premium_by_username(
  target_username TEXT,
  expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  user_id UUID;
  result JSON;
BEGIN
  -- Find user ID by username (case-insensitive)
  SELECT id INTO user_id
  FROM public.profiles
  WHERE LOWER(username) = LOWER(target_username);

  IF user_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not found',
      'username', target_username
    );
  END IF;

  -- Call the existing grant_premium_access function
  result := public.grant_premium_access(user_id, expires_at);

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.grant_premium_by_username(TEXT, TIMESTAMPTZ) TO authenticated;

-- Function to revoke premium access using username
CREATE OR REPLACE FUNCTION public.revoke_premium_by_username(
  target_username TEXT
)
RETURNS JSON AS $$
DECLARE
  user_id UUID;
  result JSON;
BEGIN
  -- Find user ID by username (case-insensitive)
  SELECT id INTO user_id
  FROM public.profiles
  WHERE LOWER(username) = LOWER(target_username);

  IF user_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not found',
      'username', target_username
    );
  END IF;

  -- Call the existing revoke_premium_access function
  result := public.revoke_premium_access(user_id);

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.revoke_premium_by_username(TEXT) TO authenticated;

-- Function to check subscription status using username
CREATE OR REPLACE FUNCTION public.get_subscription_status_by_username(
  target_username TEXT
)
RETURNS JSON AS $$
DECLARE
  user_id UUID;
  result JSON;
BEGIN
  -- Find user ID by username (case-insensitive)
  SELECT id INTO user_id
  FROM public.profiles
  WHERE LOWER(username) = LOWER(target_username);

  IF user_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not found',
      'username', target_username
    );
  END IF;

  -- Call the existing get_subscription_status function
  result := public.get_subscription_status(user_id);

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_subscription_status_by_username(TEXT) TO authenticated;
