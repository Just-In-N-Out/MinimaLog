-- Delete all user data to start fresh for launch
-- This will remove all accounts and associated data

-- Delete data from public tables first (to avoid foreign key issues)
DELETE FROM ai_suggestions;
DELETE FROM unit_overrides;
DELETE FROM template_exercises;
DELETE FROM workout_templates;
DELETE FROM session_metrics;
DELETE FROM sets;
DELETE FROM workout_exercises;
DELETE FROM workout_groups;
DELETE FROM workouts;
DELETE FROM prs;
DELETE FROM notifications;
DELETE FROM comments;
DELETE FROM likes;
DELETE FROM posts;
DELETE FROM follows;
DELETE FROM coaches;
DELETE FROM user_roles;
DELETE FROM public_profiles;
DELETE FROM profiles;

-- Finally, delete all users from auth
DELETE FROM auth.users;