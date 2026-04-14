BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pr_summary JSONB NOT NULL DEFAULT '{}'::jsonb;

DROP FUNCTION IF EXISTS public.delete_post_and_recompute_prs(UUID, UUID);

CREATE OR REPLACE FUNCTION public.delete_post_and_recompute_prs(
  p_user_id UUID,
  p_post_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_post RECORD;
  pr_results JSONB := '[]'::jsonb;
  pr_summary_payload JSONB := '{}'::jsonb;
BEGIN
  SELECT id, user_id, workout_id
    INTO target_post
  FROM public.posts
  WHERE id = p_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found' USING ERRCODE = 'P0201';
  END IF;

  IF target_post.user_id <> p_user_id THEN
    RAISE EXCEPTION 'Not authorized to delete this post' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.posts WHERE id = target_post.id;

  IF target_post.workout_id IS NOT NULL THEN
    DELETE FROM public.workouts
    WHERE id = target_post.workout_id
      AND user_id = p_user_id;
  END IF;

  DROP TABLE IF EXISTS temp_best_prs;

  CREATE TEMPORARY TABLE temp_best_prs
  ON COMMIT DROP
  AS
  WITH relevant_posts AS (
    SELECT p.workout_id, p.created_at
    FROM public.posts p
    WHERE p.user_id = p_user_id
      AND COALESCE(p.show_workout_details, TRUE) = TRUE
  ),
  relevant_sets AS (
    SELECT
      we.exercise_id,
      s.reps,
      s.weight,
      s.unit,
      rp.created_at AS posted_at,
      (s.weight * (1 + (GREATEST(s.reps, 1)::NUMERIC / 30)))::NUMERIC(10, 2) AS est_1rm
    FROM relevant_posts rp
    JOIN public.workout_exercises we ON we.workout_id = rp.workout_id
    JOIN public.sets s ON s.workout_exercise_id = we.id
    WHERE s.is_warmup = FALSE
  ),
  ranked_sets AS (
    SELECT
      exercise_id,
      reps,
      weight,
      unit,
      posted_at,
      est_1rm,
      ROW_NUMBER() OVER (
        PARTITION BY exercise_id
        ORDER BY est_1rm DESC NULLS LAST, weight DESC, posted_at DESC
      ) AS rn
    FROM relevant_sets
  )
  SELECT
    r.exercise_id,
    r.reps,
    r.weight,
    r.unit,
    r.posted_at AS achieved_at,
    r.est_1rm
  FROM ranked_sets r
  WHERE r.rn = 1;

  DELETE FROM public.prs WHERE user_id = p_user_id;

  INSERT INTO public.prs (
    user_id,
    exercise_id,
    reps,
    weight,
    unit,
    est_1rm,
    estimate_formula,
    achieved_at
  )
  SELECT
    p_user_id,
    tbp.exercise_id,
    tbp.reps,
    tbp.weight,
    tbp.unit,
    tbp.est_1rm,
    'epley',
    tbp.achieved_at
  FROM temp_best_prs tbp;

  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'exercise_id', tbp.exercise_id,
          'reps', tbp.reps,
          'weight', tbp.weight,
          'unit', tbp.unit,
          'est_1rm', tbp.est_1rm,
          'achieved_at', tbp.achieved_at,
          'exercise_name', e.name
        )
      ),
      '[]'::jsonb
    )
  INTO pr_results
  FROM temp_best_prs tbp
  JOIN public.exercises e ON e.id = tbp.exercise_id;

  SELECT
    COALESCE(
      jsonb_object_agg(
        category,
        jsonb_build_object(
          'exercise_id', exercise_id,
          'exercise_name', exercise_name,
          'weight', weight,
          'unit', unit,
          'reps', reps,
          'est_1rm', est_1rm,
          'achieved_at', achieved_at
        )
      ),
      '{}'::jsonb
    )
  INTO pr_summary_payload
  FROM (
    SELECT
      CASE
        WHEN POSITION('squat' IN LOWER(e.name)) > 0 THEN 'squat'
        WHEN POSITION('bench' IN LOWER(e.name)) > 0 THEN 'bench'
        WHEN POSITION('deadlift' IN LOWER(e.name)) > 0 THEN 'deadlift'
        ELSE NULL
      END AS category,
      tbp.exercise_id,
      e.name AS exercise_name,
      tbp.weight,
      tbp.unit,
      tbp.reps,
      tbp.est_1rm,
      tbp.achieved_at
    FROM temp_best_prs tbp
    JOIN public.exercises e ON e.id = tbp.exercise_id
  ) categorized
  WHERE category IS NOT NULL;

  UPDATE public.profiles
  SET pr_summary = COALESCE(pr_summary_payload, '{}'::jsonb),
      updated_at = NOW()
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'prs', pr_results,
    'summary', COALESCE(pr_summary_payload, '{}'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_post_and_recompute_prs(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_post_and_recompute_prs(UUID, UUID) TO service_role;

COMMIT;
