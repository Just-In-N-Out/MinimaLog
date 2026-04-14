-- Add training_style column to profiles table
ALTER TABLE profiles
ADD COLUMN training_style TEXT;

-- Add comment to document the column
COMMENT ON COLUMN profiles.training_style IS 'User''s preferred training approach: solo, accountability, or social';
