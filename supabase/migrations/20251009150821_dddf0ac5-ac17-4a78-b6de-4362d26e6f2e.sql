-- Clean up any remaining duplicates (for exercises with 3+ copies)
-- Keep the first one, delete all others

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
WHERE we.exercise_id = ANY(d.ids[2:]);

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
WHERE te.exercise_id = ANY(d.ids[2:]);

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
WHERE prs.exercise_id = ANY(d.ids[2:]);

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
WHERE uo.exercise_id = ANY(d.ids[2:]);

-- Delete all duplicate exercises except the first
DELETE FROM exercises
WHERE id IN (
  SELECT unnest(ids[2:])
  FROM (
    SELECT array_agg(id ORDER BY created_at) as ids
    FROM exercises
    WHERE owner_user_id IS NULL
    GROUP BY name
    HAVING COUNT(*) > 1
  ) duplicates
);