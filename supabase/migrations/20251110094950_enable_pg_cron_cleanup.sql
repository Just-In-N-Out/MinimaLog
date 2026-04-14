-- Migration: Enable pg_cron and schedule automatic cleanup of stale workouts
-- Description: Uses PostgreSQL pg_cron extension to run cleanup every 6 hours

-- Enable pg_cron extension (requires superuser privileges, available on Supabase)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage on cron schema to postgres role
GRANT USAGE ON SCHEMA cron TO postgres;

-- Schedule the cleanup job to run every 6 hours
-- This will delete workouts that have been active for more than 48 hours
SELECT cron.schedule(
  'cleanup-stale-workouts',           -- Job name
  '0 */6 * * *',                      -- Cron schedule: every 6 hours (at 00:00, 06:00, 12:00, 18:00 UTC)
  $$SELECT cleanup_stale_workouts()$$ -- Command to run
);

-- Add comment for documentation
COMMENT ON EXTENSION pg_cron IS 'Job scheduler for PostgreSQL - used to automatically cleanup stale workouts every 6 hours';
