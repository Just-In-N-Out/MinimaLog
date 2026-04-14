-- Create table for AI suggestion history
CREATE TABLE public.ai_suggestions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  session_focus TEXT,
  suggestions JSONB NOT NULL,
  balance_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ai_suggestions ENABLE ROW LEVEL SECURITY;

-- Users can view their own suggestions
CREATE POLICY "Users can view their own suggestions"
ON public.ai_suggestions
FOR SELECT
USING (auth.uid() = user_id);

-- Users can create their own suggestions
CREATE POLICY "Users can create their own suggestions"
ON public.ai_suggestions
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Create index for faster queries
CREATE INDEX idx_ai_suggestions_user_created ON public.ai_suggestions(user_id, created_at DESC);