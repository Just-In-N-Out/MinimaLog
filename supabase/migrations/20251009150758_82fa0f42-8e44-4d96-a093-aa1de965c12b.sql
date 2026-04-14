-- Fix duplicate exercises by updating references and deleting duplicates
-- Step 1: Update workout_exercises to reference the first occurrence of each duplicate exercise

WITH duplicates AS (
  SELECT 
    name,
    array_agg(id ORDER BY created_at) as ids
  FROM exercises
  WHERE owner_user_id IS NULL
  GROUP BY name
  HAVING COUNT(*) > 1
)
UPDATE workout_exercises we
SET exercise_id = d.ids[1]
FROM duplicates d
WHERE we.exercise_id = d.ids[2];

-- Step 2: Update template_exercises to reference the first occurrence

WITH duplicates AS (
  SELECT 
    name,
    array_agg(id ORDER BY created_at) as ids
  FROM exercises
  WHERE owner_user_id IS NULL
  GROUP BY name
  HAVING COUNT(*) > 1
)
UPDATE template_exercises te
SET exercise_id = d.ids[1]
FROM duplicates d
WHERE te.exercise_id = d.ids[2];

-- Step 3: Update prs to reference the first occurrence

WITH duplicates AS (
  SELECT 
    name,
    array_agg(id ORDER BY created_at) as ids
  FROM exercises
  WHERE owner_user_id IS NULL
  GROUP BY name
  HAVING COUNT(*) > 1
)
UPDATE prs
SET exercise_id = d.ids[1]
FROM duplicates d
WHERE prs.exercise_id = d.ids[2];

-- Step 4: Update unit_overrides to reference the first occurrence

WITH duplicates AS (
  SELECT 
    name,
    array_agg(id ORDER BY created_at) as ids
  FROM exercises
  WHERE owner_user_id IS NULL
  GROUP BY name
  HAVING COUNT(*) > 1
)
UPDATE unit_overrides uo
SET exercise_id = d.ids[1]
FROM duplicates d
WHERE uo.exercise_id = d.ids[2];

-- Step 5: Now delete duplicate exercises

DELETE FROM exercises
WHERE id IN (
  SELECT ids[2]
  FROM (
    SELECT array_agg(id ORDER BY created_at) as ids
    FROM exercises
    WHERE owner_user_id IS NULL
    GROUP BY name
    HAVING COUNT(*) > 1
  ) duplicates
);