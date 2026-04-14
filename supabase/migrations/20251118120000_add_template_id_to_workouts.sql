-- Add template_id to workouts so we can track which template populated a workout
ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.workout_templates(id) ON DELETE SET NULL;

-- Index to speed up lookups by template
CREATE INDEX IF NOT EXISTS idx_workouts_template_id ON public.workouts(template_id);
