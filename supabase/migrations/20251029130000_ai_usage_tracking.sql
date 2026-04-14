-- Create ai_usage_tracking table for rate limiting AI suggestions
CREATE TABLE IF NOT EXISTS public.ai_usage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  request_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure one record per user per day
  UNIQUE(user_id, date)
);

-- Add index for fast lookups
CREATE INDEX idx_ai_usage_tracking_user_date ON public.ai_usage_tracking(user_id, date);

-- Enable RLS
ALTER TABLE public.ai_usage_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only read their own usage
CREATE POLICY "Users can view their own AI usage"
  ON public.ai_usage_tracking
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policy: Service role can insert/update for rate limiting
CREATE POLICY "Service role can manage AI usage"
  ON public.ai_usage_tracking
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_ai_usage_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on changes
CREATE TRIGGER ai_usage_tracking_updated_at
  BEFORE UPDATE ON public.ai_usage_tracking
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_ai_usage_updated_at();

-- Update ai_suggestions table to make it more user-friendly
ALTER TABLE public.ai_suggestions
  ALTER COLUMN suggestions TYPE JSONB USING suggestions::JSONB,
  ADD COLUMN IF NOT EXISTS tips TEXT[] DEFAULT '{}';

-- Add comment for clarity
COMMENT ON TABLE public.ai_usage_tracking IS 'Tracks daily AI suggestion usage per user for rate limiting (3 per day)';
COMMENT ON COLUMN public.ai_usage_tracking.request_count IS 'Number of AI suggestions generated today';
COMMENT ON COLUMN public.ai_suggestions.tips IS 'Array of simple tip strings for user display';
