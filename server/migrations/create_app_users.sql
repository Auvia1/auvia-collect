-- ============================================================
-- Standalone authentication table for Auvia Collect
-- (bypasses the Supabase auth.users FK on the profiles table)
-- ============================================================
CREATE TABLE IF NOT EXISTS app_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     text NOT NULL,
  email         citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  platform_role text NOT NULL DEFAULT 'standard',  -- 'platform_admin' | 'standard'
  phone         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_users_email ON app_users (email);
