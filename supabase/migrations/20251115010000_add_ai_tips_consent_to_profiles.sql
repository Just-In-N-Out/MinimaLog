-- Add ai_tips_consent field to profiles table for tracking user consent to share data with Google Gemini AI
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS ai_tips_consent BOOLEAN DEFAULT NULL;

-- Add column comment for documentation
COMMENT ON COLUMN public.profiles.ai_tips_consent IS 'User consent to share workout data with Google Gemini AI for workout tips. NULL = not asked, true = consented, false = declined';

-- Add ai_tips_consent_granted_at timestamp
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS ai_tips_consent_granted_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.profiles.ai_tips_consent_granted_at IS 'Timestamp when user granted consent for AI tips feature';
