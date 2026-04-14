-- Allow users to read workout_exercises when a post shares details
CREATE POLICY "Users can view shared workout exercises"
  ON public.workout_exercises
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.posts
      WHERE posts.workout_id = workout_exercises.workout_id
        AND posts.show_workout_details = true
    )
  );

-- Allow users to read sets when a post shares details
CREATE POLICY "Users can view shared sets"
  ON public.sets
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.workout_exercises
      JOIN public.posts
        ON posts.workout_id = workout_exercises.workout_id
      WHERE workout_exercises.id = sets.workout_exercise_id
        AND posts.show_workout_details = true
    )
  );
