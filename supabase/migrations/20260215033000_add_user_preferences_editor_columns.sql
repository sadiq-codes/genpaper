-- Align user_preferences schema with current settings API usage.
-- Fixes PGRST204 errors like:
-- "Could not find the 'accept_key' column of 'user_preferences' in the schema cache"

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS default_paper_type text NOT NULL DEFAULT 'literatureReview',
  ADD COLUMN IF NOT EXISTS auto_suggestions boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS include_citations boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accept_key text NOT NULL DEFAULT 'tab',
  ADD COLUMN IF NOT EXISTS use_external_sources boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS font_size text NOT NULL DEFAULT 'medium';

-- Ensure PostgREST picks up new columns immediately.
NOTIFY pgrst, 'reload schema';

