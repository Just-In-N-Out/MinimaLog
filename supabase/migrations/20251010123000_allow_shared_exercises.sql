CREATE POLICY "Users can view exercises from shared workouts"
  ON public.exercises
  FOR SELECT
  USING (
    owner_user_id IS NULL
    OR owner_user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.workout_exercises we
      JOIN public.posts p ON p.workout_id = we.workout_id
      WHERE we.exercise_id = exercises.id
        AND p.show_workout_details = true
    )
  );
