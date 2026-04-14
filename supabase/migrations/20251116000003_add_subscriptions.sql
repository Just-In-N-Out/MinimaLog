-- Add subscription fields to profiles table
ALTER TABLE public.profiles
  ADD COLUMN subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'premium')),
  ADD COLUMN revenuecat_user_id TEXT UNIQUE,
  ADD COLUMN trial_started_at TIMESTAMPTZ,
  ADD COLUMN trial_ends_at TIMESTAMPTZ,
  ADD COLUMN subscription_started_at TIMESTAMPTZ,
  ADD COLUMN subscription_expires_at TIMESTAMPTZ,
  ADD COLUMN last_subscription_check TIMESTAMPTZ DEFAULT NOW();

-- Index for fast subscription lookups
CREATE INDEX idx_profiles_subscription ON public.profiles(subscription_tier, subscription_expires_at);

-- Function to check if user is premium (for RLS policies)
CREATE OR REPLACE FUNCTION public.is_premium_user(user_id_input UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = user_id_input
    AND subscription_tier = 'premium'
    AND (subscription_expires_at IS NULL OR subscription_expires_at > NOW())
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add monthly usage tracking table
CREATE TABLE public.monthly_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  month_year TEXT NOT NULL, -- Format: 'YYYY-MM'
  workout_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, month_year)
);

CREATE INDEX idx_monthly_usage_user_month ON public.monthly_usage(user_id, month_year DESC);
ALTER TABLE public.monthly_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own usage"
  ON public.monthly_usage FOR SELECT
  USING (auth.uid() = user_id);

-- Trigger to increment workout count
CREATE OR REPLACE FUNCTION public.increment_workout_count()
RETURNS TRIGGER AS $$
DECLARE
  current_month TEXT;
BEGIN
  current_month := TO_CHAR(NEW.started_at, 'YYYY-MM');

  INSERT INTO public.monthly_usage (user_id, month_year, workout_count)
  VALUES (NEW.user_id, current_month, 1)
  ON CONFLICT (user_id, month_year)
  DO UPDATE SET
    workout_count = public.monthly_usage.workout_count + 1,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER track_workout_usage
  AFTER INSERT ON public.workouts
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_workout_count();

-- RLS Policies for premium features
CREATE POLICY "Only premium users can create posts"
  ON public.posts FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    public.is_premium_user(auth.uid())
  );

CREATE POLICY "Free users limited to 1 template"
  ON public.workout_templates FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    (
      public.is_premium_user(auth.uid()) OR
      (SELECT COUNT(*) FROM public.workout_templates WHERE user_id = auth.uid()) < 1
    )
  );
