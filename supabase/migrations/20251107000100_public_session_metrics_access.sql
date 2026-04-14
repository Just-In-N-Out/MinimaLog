BEGIN;

CREATE POLICY "Public posts expose session metrics"
  ON public.session_metrics
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.posts
      WHERE posts.workout_id = session_metrics.workout_id
        AND posts.is_private = FALSE
        AND COALESCE(posts.show_workout_details, TRUE) = TRUE
    )
  );

COMMIT;
