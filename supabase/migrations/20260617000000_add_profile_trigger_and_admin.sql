-- Migration: Add is_admin column and auto-create profile trigger
-- This simplifies auth by:
-- 1. Moving admin check to database (no hardcoded IDs)
-- 2. Auto-creating profiles on user signup (no callback code needed)

-- Add is_admin column to profiles if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'is_admin'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN is_admin boolean DEFAULT false;
  END IF;
END $$;

-- Set existing admin users (migrate from hardcoded list)
UPDATE public.profiles 
SET is_admin = true 
WHERE id = 'e97fda5f-92d7-4087-be83-ca26aea7faaa';

-- Create index for admin queries
CREATE INDEX IF NOT EXISTS idx_profiles_is_admin ON public.profiles(is_admin) WHERE is_admin = true;

-- Function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, created_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      ''
    ),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), public.profiles.full_name);
  
  RETURN NEW;
END;
$$;

-- Create trigger for auto-profile creation (if not exists)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Also update profile on user metadata changes (e.g., OAuth profile update)
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE OF raw_user_meta_data ON auth.users
  FOR EACH ROW
  WHEN (OLD.raw_user_meta_data IS DISTINCT FROM NEW.raw_user_meta_data)
  EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user() IS 'Automatically creates/updates profile when a user signs up or updates their metadata';
COMMENT ON COLUMN public.profiles.is_admin IS 'Admin flag - set via database, not hardcoded in app';
