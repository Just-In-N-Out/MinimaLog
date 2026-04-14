-- Add bodyweight to profiles table for tracking
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bodyweight DECIMAL(10, 2);