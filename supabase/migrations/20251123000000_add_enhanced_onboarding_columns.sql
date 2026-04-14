-- Add enhanced onboarding columns to profiles table
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS training_time_preference TEXT,
ADD COLUMN IF NOT EXISTS time_commitment TEXT,
ADD COLUMN IF NOT EXISTS fitness_journey_stage TEXT,
ADD COLUMN IF NOT EXISTS biggest_obstacle TEXT,
ADD COLUMN IF NOT EXISTS workout_feeling TEXT,
ADD COLUMN IF NOT EXISTS lifting_meaning TEXT,
ADD COLUMN IF NOT EXISTS motivation_source TEXT,
ADD COLUMN IF NOT EXISTS best_self_vision TEXT,
ADD COLUMN IF NOT EXISTS one_year_goal TEXT,
ADD COLUMN IF NOT EXISTS pride_metric TEXT;

-- Add comments to document the columns
COMMENT ON COLUMN profiles.training_time_preference IS 'Preferred training time: morning, midday, evening, or flexible';
COMMENT ON COLUMN profiles.time_commitment IS 'Time commitment per session: 30min, 45-60min, 60-90min, or 120min+';
COMMENT ON COLUMN profiles.fitness_journey_stage IS 'Current fitness journey stage: starting, returning, experienced, or recovering';
COMMENT ON COLUMN profiles.biggest_obstacle IS 'User''s biggest fitness obstacle: time, motivation, knowledge, doubt, or limitations';
COMMENT ON COLUMN profiles.workout_feeling IS 'Desired post-workout feeling: accomplished, peaceful, powerful, or connected';
COMMENT ON COLUMN profiles.lifting_meaning IS 'What lifting represents: therapy, discipline, self-care, or promise';
COMMENT ON COLUMN profiles.motivation_source IS 'Source of motivation on tough days: why_started, just_show_up, feel_after, or support';
COMMENT ON COLUMN profiles.best_self_vision IS 'Vision of best self: never_gives_up, at_home_in_body, inspires_others, or proves_wrong';
COMMENT ON COLUMN profiles.one_year_goal IS 'One year aspiration: didnt_quit, got_stronger, believed_self, or inspired_others';
COMMENT ON COLUMN profiles.pride_metric IS 'What would make them proud: consistency, strength_goal, comfortable_in_skin, or routine';
