-- Add password_hash column to profiles for standalone (non-Supabase-Auth) login
-- Run this once against your database:
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_hash text;
