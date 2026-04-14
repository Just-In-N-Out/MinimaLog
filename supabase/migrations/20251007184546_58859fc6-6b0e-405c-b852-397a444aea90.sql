-- Add workout templates table
CREATE TABLE public.workout_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Template exercises
CREATE TABLE public.template_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.workout_templates(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES public.exercises(id) ON DELETE RESTRICT,
  order_index INTEGER NOT NULL,
  target_sets INTEGER,
  target_reps INTEGER,
  target_weight DECIMAL(10, 2),
  target_unit unit_type,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.workout_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_exercises ENABLE ROW LEVEL SECURITY;

-- RLS Policies for workout_templates
CREATE POLICY "Users can view their own templates"
  ON public.workout_templates FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own templates"
  ON public.workout_templates FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own templates"
  ON public.workout_templates FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own templates"
  ON public.workout_templates FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for template_exercises
CREATE POLICY "Users can manage template exercises"
  ON public.template_exercises FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.workout_templates
    WHERE workout_templates.id = template_exercises.template_id
    AND workout_templates.user_id = auth.uid()
  ));

-- Add updated_at trigger for templates
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workout_templates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Create indexes
CREATE INDEX idx_workout_templates_user ON public.workout_templates(user_id, created_at DESC);
CREATE INDEX idx_template_exercises_template ON public.template_exercises(template_id, order_index);

-- Remove bodyweight from session_metrics (we'll track it in profile instead)
-- Keep the columns for historical data but we won't use them for new workouts
ALTER TABLE public.session_metrics ALTER COLUMN bodyweight DROP NOT NULL;
ALTER TABLE public.session_metrics ALTER COLUMN bodyweight_unit DROP NOT NULL;