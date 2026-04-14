-- Add soreness area tracking to pre-session metrics
ALTER TABLE public.session_metrics
ADD COLUMN IF NOT EXISTS soreness_area TEXT;

ALTER TABLE public.session_metrics
DROP CONSTRAINT IF EXISTS session_metrics_soreness_area_check;

ALTER TABLE public.session_metrics
ADD CONSTRAINT session_metrics_soreness_area_check
CHECK (
  soreness_area IS NULL
  OR soreness_area IN ('none', 'upper', 'lower', 'full')
);
