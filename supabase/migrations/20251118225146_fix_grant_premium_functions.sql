-- Fix grant_premium_access function to use username instead of email

CREATE OR REPLACE FUNCTION public.grant_premium_access(
  target_user_id UUID,
  expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  result JSON;
  user_username TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_user_id) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not found',
      'user_id', target_user_id
    );
  END IF;

  SELECT username INTO user_username FROM public.profiles WHERE id = target_user_id;

  UPDATE public.profiles
  SET
    subscription_tier = 'premium',
    subscription_started_at = NOW(),
    subscription_expires_at = expires_at,
    last_subscription_check = NOW(),
    updated_at = NOW()
  WHERE id = target_user_id;

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

CREATE OR REPLACE FUNCTION public.revoke_premium_access(
  target_user_id UUID
)
RETURNS JSON AS $$
DECLARE
  result JSON;
  user_username TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_user_id) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not found',
      'user_id', target_user_id
    );
  END IF;

  SELECT username INTO user_username FROM public.profiles WHERE id = target_user_id;

  UPDATE public.profiles
  SET
    subscription_tier = 'free',
    subscription_expires_at = NOW(),
    last_subscription_check = NOW(),
    updated_at = NOW()
  WHERE id = target_user_id;

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
