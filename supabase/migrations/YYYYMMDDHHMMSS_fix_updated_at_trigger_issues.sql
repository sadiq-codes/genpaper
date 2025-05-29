BEGIN;

-- 0. Ensure the uuid-ossp extension is available if not already.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Re-define or ensure the trigger function exists and is correct.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Fix for public.projects table
DO $$
BEGIN
    -- Add 'updated_at' column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE public.projects ADD COLUMN updated_at TIMESTAMPTZ;
    END IF;

    -- Initialize 'updated_at' for existing rows where it's NULL.
    -- Assumes 'created_at' column exists in 'projects' table for coalescing.
    -- If 'created_at' is not present or also NULL, 'now()' will be used.
    UPDATE public.projects SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS NULL;

    -- Set DEFAULT and NOT NULL constraints on 'updated_at'.
    -- The UPDATE above makes setting NOT NULL safe.
    ALTER TABLE public.projects
        ALTER COLUMN updated_at SET DEFAULT now(),
        ALTER COLUMN updated_at SET NOT NULL;

    -- Recreate the trigger to ensure it's correctly defined and linked.
    DROP TRIGGER IF EXISTS set_projects_updated_at ON public.projects;
    CREATE TRIGGER set_projects_updated_at
        BEFORE UPDATE ON public.projects
        FOR EACH ROW
        EXECUTE FUNCTION public.update_updated_at_column();
END $$;

-- 3. Fix for public.paper_sections table
DO $$
BEGIN
    -- Add 'updated_at' column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'paper_sections' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE public.paper_sections ADD COLUMN updated_at TIMESTAMPTZ;
    END IF;

    -- Initialize 'updated_at' for existing rows where it's NULL.
    -- Assumes 'created_at' column exists in 'paper_sections' table.
    UPDATE public.paper_sections SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS NULL;

    -- Set DEFAULT and NOT NULL constraints on 'updated_at'.
    ALTER TABLE public.paper_sections
        ALTER COLUMN updated_at SET DEFAULT now(),
        ALTER COLUMN updated_at SET NOT NULL;

    -- Recreate the trigger.
    DROP TRIGGER IF EXISTS set_paper_sections_updated_at ON public.paper_sections;
    CREATE TRIGGER set_paper_sections_updated_at
        BEFORE UPDATE ON public.paper_sections
        FOR EACH ROW
        EXECUTE FUNCTION public.update_updated_at_column();
END $$;

COMMIT; 