-- Add metadata field to profiles table for user location storage
-- This enables automatic regional boosting based on user's detected location

DO $$
BEGIN
  -- Add metadata column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE profiles ADD COLUMN metadata JSONB DEFAULT '{}';
  END IF;
END $$;

-- Create index for efficient location queries
CREATE INDEX IF NOT EXISTS idx_profiles_location 
ON profiles USING GIN ((metadata->'location'));

-- Create index for location country queries
CREATE INDEX IF NOT EXISTS idx_profiles_location_country 
ON profiles ((metadata->'location'->>'country'));

-- Add helpful comment
COMMENT ON COLUMN profiles.metadata IS 'User metadata including auto-detected location for regional paper boosting'; 