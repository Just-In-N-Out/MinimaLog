-- Add category metadata to AI suggestions for analytics and filtering
ALTER TABLE public.ai_suggestions
  ADD COLUMN IF NOT EXISTS tip_categories TEXT[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS tip_metadata JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.ai_suggestions.tip_categories IS 'Category tag per tip to track variety';
COMMENT ON COLUMN public.ai_suggestions.tip_metadata IS 'Additional metadata for AI tips (novelty metrics, etc.)';
