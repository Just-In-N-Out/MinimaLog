-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum types
CREATE TYPE public.app_role AS ENUM ('lifter', 'coach');
CREATE TYPE public.unit_type AS ENUM ('kg', 'lb');
CREATE TYPE public.coach_status AS ENUM ('pending', 'active', 'revoked');

-- Profiles table (extends auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  unit_default unit_type NOT NULL DEFAULT 'kg',
  age_verified_16_plus BOOLEAN NOT NULL DEFAULT false,
  age_verified_16_plus_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User roles table (separate from profiles for security)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'lifter',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

-- Exercises library (global + user custom)
CREATE TABLE public.exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  equipment TEXT,
  muscle_group TEXT,
  body_part TEXT,
  is_bodyweight BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Workouts
CREATE TABLE public.workouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  notes TEXT,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Workout groups (for supersets)
CREATE TABLE public.workout_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id UUID NOT NULL REFERENCES public.workouts(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'superset',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Workout exercises
CREATE TABLE public.workout_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id UUID NOT NULL REFERENCES public.workouts(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES public.exercises(id) ON DELETE RESTRICT,
  group_id UUID REFERENCES public.workout_groups(id) ON DELETE SET NULL,
  order_index INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sets
CREATE TABLE public.sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_exercise_id UUID NOT NULL REFERENCES public.workout_exercises(id) ON DELETE CASCADE,
  set_no INTEGER NOT NULL,
  weight DECIMAL(10, 2) NOT NULL,
  unit unit_type NOT NULL,
  reps INTEGER NOT NULL,
  rpe DECIMAL(3, 1),
  rir INTEGER,
  is_warmup BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Session metrics (pre-workout data)
CREATE TABLE public.session_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id UUID NOT NULL REFERENCES public.workouts(id) ON DELETE CASCADE,
  bodyweight DECIMAL(10, 2),
  bodyweight_unit unit_type,
  sleep INTEGER CHECK (sleep >= 1 AND sleep <= 5),
  mood INTEGER CHECK (mood >= 1 AND mood <= 5),
  preworkout BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workout_id)
);

-- PRs (personal records)
CREATE TABLE public.prs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  reps INTEGER NOT NULL,
  weight DECIMAL(10, 2) NOT NULL,
  unit unit_type NOT NULL,
  est_1rm DECIMAL(10, 2),
  estimate_formula TEXT,
  achieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unit overrides (per-exercise unit preferences)
CREATE TABLE public.unit_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  unit unit_type NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, exercise_id)
);

-- Coaches (for future coach linking feature)
CREATE TABLE public.coaches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  coach_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status coach_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, coach_user_id)
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coaches ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- RLS Policies for user_roles
CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policies for exercises
CREATE POLICY "Users can view global and their own exercises"
  ON public.exercises FOR SELECT
  USING (owner_user_id IS NULL OR owner_user_id = auth.uid());

CREATE POLICY "Users can create their own custom exercises"
  ON public.exercises FOR INSERT
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Users can update their own custom exercises"
  ON public.exercises FOR UPDATE
  USING (owner_user_id = auth.uid());

CREATE POLICY "Users can delete their own custom exercises"
  ON public.exercises FOR DELETE
  USING (owner_user_id = auth.uid());

-- RLS Policies for workouts
CREATE POLICY "Users can view their own workouts"
  ON public.workouts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own workouts"
  ON public.workouts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own workouts"
  ON public.workouts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own workouts"
  ON public.workouts FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for workout_groups
CREATE POLICY "Users can manage workout groups for their workouts"
  ON public.workout_groups FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.workouts
    WHERE workouts.id = workout_groups.workout_id
    AND workouts.user_id = auth.uid()
  ));

-- RLS Policies for workout_exercises
CREATE POLICY "Users can manage exercises in their workouts"
  ON public.workout_exercises FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.workouts
    WHERE workouts.id = workout_exercises.workout_id
    AND workouts.user_id = auth.uid()
  ));

-- RLS Policies for sets
CREATE POLICY "Users can manage sets in their workouts"
  ON public.sets FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.workout_exercises
    JOIN public.workouts ON workouts.id = workout_exercises.workout_id
    WHERE workout_exercises.id = sets.workout_exercise_id
    AND workouts.user_id = auth.uid()
  ));

-- RLS Policies for session_metrics
CREATE POLICY "Users can manage metrics for their workouts"
  ON public.session_metrics FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.workouts
    WHERE workouts.id = session_metrics.workout_id
    AND workouts.user_id = auth.uid()
  ));

-- RLS Policies for prs
CREATE POLICY "Users can view their own PRs"
  ON public.prs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own PRs"
  ON public.prs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own PRs"
  ON public.prs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own PRs"
  ON public.prs FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for unit_overrides
CREATE POLICY "Users can manage their own unit overrides"
  ON public.unit_overrides FOR ALL
  USING (auth.uid() = user_id);

-- RLS Policies for coaches
CREATE POLICY "Users can view their coach relationships"
  ON public.coaches FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = coach_user_id);

CREATE POLICY "Users can create coach invites"
  ON public.coaches FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update coach relationships"
  ON public.coaches FOR UPDATE
  USING (auth.uid() = user_id OR auth.uid() = coach_user_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply updated_at triggers
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.exercises
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workouts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.sets
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.coaches
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Create function to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', '')
  );
  
  -- Assign default lifter role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'lifter');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger to create profile on user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create indexes for performance
CREATE INDEX idx_workouts_user_created ON public.workouts(user_id, created_at DESC);
CREATE INDEX idx_prs_user_achieved ON public.prs(user_id, achieved_at DESC);
CREATE INDEX idx_prs_exercise ON public.prs(exercise_id, achieved_at DESC);
CREATE INDEX idx_exercises_owner ON public.exercises(owner_user_id);
CREATE INDEX idx_workout_exercises_workout ON public.workout_exercises(workout_id, order_index);
CREATE INDEX idx_sets_workout_exercise ON public.sets(workout_exercise_id, set_no);

-- Seed global exercises
INSERT INTO public.exercises (name, equipment, muscle_group, body_part, is_bodyweight) VALUES
  -- Chest
  ('Barbell Bench Press', 'Barbell', 'Chest', 'Upper Body', false),
  ('Incline Barbell Bench Press', 'Barbell', 'Chest', 'Upper Body', false),
  ('Dumbbell Bench Press', 'Dumbbell', 'Chest', 'Upper Body', false),
  ('Incline Dumbbell Press', 'Dumbbell', 'Chest', 'Upper Body', false),
  ('Push-ups', 'Bodyweight', 'Chest', 'Upper Body', true),
  ('Cable Chest Fly', 'Cable', 'Chest', 'Upper Body', false),
  
  -- Back
  ('Barbell Row', 'Barbell', 'Back', 'Upper Body', false),
  ('Deadlift', 'Barbell', 'Back', 'Full Body', false),
  ('Pull-ups', 'Bodyweight', 'Back', 'Upper Body', true),
  ('Lat Pulldown', 'Cable', 'Back', 'Upper Body', false),
  ('Seated Cable Row', 'Cable', 'Back', 'Upper Body', false),
  ('T-Bar Row', 'Barbell', 'Back', 'Upper Body', false),
  
  -- Shoulders
  ('Overhead Press', 'Barbell', 'Shoulders', 'Upper Body', false),
  ('Dumbbell Shoulder Press', 'Dumbbell', 'Shoulders', 'Upper Body', false),
  ('Lateral Raises', 'Dumbbell', 'Shoulders', 'Upper Body', false),
  ('Face Pulls', 'Cable', 'Shoulders', 'Upper Body', false),
  
  -- Legs
  ('Barbell Squat', 'Barbell', 'Legs', 'Lower Body', false),
  ('Front Squat', 'Barbell', 'Legs', 'Lower Body', false),
  ('Leg Press', 'Machine', 'Legs', 'Lower Body', false),
  ('Romanian Deadlift', 'Barbell', 'Hamstrings', 'Lower Body', false),
  ('Leg Curl', 'Machine', 'Hamstrings', 'Lower Body', false),
  ('Leg Extension', 'Machine', 'Quadriceps', 'Lower Body', false),
  ('Calf Raises', 'Machine', 'Calves', 'Lower Body', false),
  
  -- Arms
  ('Barbell Curl', 'Barbell', 'Biceps', 'Upper Body', false),
  ('Dumbbell Curl', 'Dumbbell', 'Biceps', 'Upper Body', false),
  ('Hammer Curl', 'Dumbbell', 'Biceps', 'Upper Body', false),
  ('Tricep Dips', 'Bodyweight', 'Triceps', 'Upper Body', true),
  ('Close-Grip Bench Press', 'Barbell', 'Triceps', 'Upper Body', false),
  ('Tricep Pushdown', 'Cable', 'Triceps', 'Upper Body', false),
  
  -- Core
  ('Plank', 'Bodyweight', 'Core', 'Core', true),
  ('Hanging Leg Raises', 'Bodyweight', 'Core', 'Core', true),
  ('Ab Wheel Rollout', 'Ab Wheel', 'Core', 'Core', false);