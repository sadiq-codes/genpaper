-- Add use_external_sources column to user_preferences
-- Default false: only cite papers within the project unless opted in
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS use_external_sources boolean NOT NULL DEFAULT false;
