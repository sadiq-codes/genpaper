-- ============================================================================
-- CRITICAL SECURITY FIX: Enable Row Level Security (RLS) on all tables
-- ============================================================================
-- This migration addresses the critical vulnerability where database tables
-- were exposed to any authenticated user via the Supabase Data API.
--
-- Without RLS, users could bypass the application API and directly query/modify
-- other users' data through the Supabase REST API or client library.
-- ============================================================================

-- ============================================================================
-- 1. PROFILES TABLE
-- ============================================================================
-- Users can only access their own profile
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can view their own profile
CREATE POLICY "Users can view own profile" 
  ON profiles FOR SELECT 
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile" 
  ON profiles FOR UPDATE 
  USING (auth.uid() = id);

-- Users can insert their own profile (for signup)
CREATE POLICY "Users can insert own profile" 
  ON profiles FOR INSERT 
  WITH CHECK (auth.uid() = id);

-- ============================================================================
-- 2. RESEARCH_PROJECTS TABLE
-- ============================================================================
-- Users can only access their own projects
ALTER TABLE research_projects ENABLE ROW LEVEL SECURITY;

-- Users can view their own projects
CREATE POLICY "Users can view own projects" 
  ON research_projects FOR SELECT 
  USING (auth.uid() = user_id);

-- Users can create their own projects
CREATE POLICY "Users can create own projects" 
  ON research_projects FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own projects
CREATE POLICY "Users can update own projects" 
  ON research_projects FOR UPDATE 
  USING (auth.uid() = user_id);

-- Users can delete their own projects
CREATE POLICY "Users can delete own projects" 
  ON research_projects FOR DELETE 
  USING (auth.uid() = user_id);

-- ============================================================================
-- 3. LIBRARY_PAPERS TABLE
-- ============================================================================
-- Users can only access papers in their own library
ALTER TABLE library_papers ENABLE ROW LEVEL SECURITY;

-- Users can view their own library papers
CREATE POLICY "Users can view own library papers" 
  ON library_papers FOR SELECT 
  USING (auth.uid() = user_id);

-- Users can add papers to their own library
CREATE POLICY "Users can add to own library" 
  ON library_papers FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own library entries
CREATE POLICY "Users can update own library entries" 
  ON library_papers FOR UPDATE 
  USING (auth.uid() = user_id);

-- Users can remove papers from their own library
CREATE POLICY "Users can remove from own library" 
  ON library_papers FOR DELETE 
  USING (auth.uid() = user_id);

-- ============================================================================
-- 4. PROJECT_CITATIONS TABLE
-- ============================================================================
-- Users can only access citations from their own projects
ALTER TABLE project_citations ENABLE ROW LEVEL SECURITY;

-- Users can view citations from their own projects
CREATE POLICY "Users can view own project citations" 
  ON project_citations FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM research_projects rp 
      WHERE rp.id = project_citations.project_id 
      AND rp.user_id = auth.uid()
    )
  );

-- Users can create citations in their own projects
CREATE POLICY "Users can create citations in own projects" 
  ON project_citations FOR INSERT 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM research_projects rp 
      WHERE rp.id = project_citations.project_id 
      AND rp.user_id = auth.uid()
    )
  );

-- Users can update citations in their own projects
CREATE POLICY "Users can update citations in own projects" 
  ON project_citations FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM research_projects rp 
      WHERE rp.id = project_citations.project_id 
      AND rp.user_id = auth.uid()
    )
  );

-- Users can delete citations from their own projects
CREATE POLICY "Users can delete citations from own projects" 
  ON project_citations FOR DELETE 
  USING (
    EXISTS (
      SELECT 1 FROM research_projects rp 
      WHERE rp.id = project_citations.project_id 
      AND rp.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 5. PAPERS TABLE
-- ============================================================================
-- Papers are a shared resource - any authenticated user can read them
-- but only the system (service role) can create/update/delete
ALTER TABLE papers ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read papers (shared knowledge base)
CREATE POLICY "Authenticated users can view papers" 
  ON papers FOR SELECT 
  TO authenticated 
  USING (true);

-- Only service role can insert papers (via API endpoints)
-- Regular users insert papers through the API which uses service role
CREATE POLICY "Service role can insert papers" 
  ON papers FOR INSERT 
  TO service_role 
  WITH CHECK (true);

-- Only service role can update papers
CREATE POLICY "Service role can update papers" 
  ON papers FOR UPDATE 
  TO service_role 
  USING (true);

-- Only service role can delete papers
CREATE POLICY "Service role can delete papers" 
  ON papers FOR DELETE 
  TO service_role 
  USING (true);

-- ============================================================================
-- 6. PAPER_CHUNKS TABLE
-- ============================================================================
-- Paper chunks follow the same pattern as papers
ALTER TABLE paper_chunks ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read chunks (for RAG/search)
CREATE POLICY "Authenticated users can view paper chunks" 
  ON paper_chunks FOR SELECT 
  TO authenticated 
  USING (true);

-- Only service role can manage chunks
CREATE POLICY "Service role can insert paper chunks" 
  ON paper_chunks FOR INSERT 
  TO service_role 
  WITH CHECK (true);

CREATE POLICY "Service role can update paper chunks" 
  ON paper_chunks FOR UPDATE 
  TO service_role 
  USING (true);

CREATE POLICY "Service role can delete paper chunks" 
  ON paper_chunks FOR DELETE 
  TO service_role 
  USING (true);

-- ============================================================================
-- 7. PAPER_CLAIMS TABLE
-- ============================================================================
-- Claims are derived from papers, same access pattern
ALTER TABLE paper_claims ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read claims
CREATE POLICY "Authenticated users can view paper claims" 
  ON paper_claims FOR SELECT 
  TO authenticated 
  USING (true);

-- Only service role can manage claims
CREATE POLICY "Service role can insert paper claims" 
  ON paper_claims FOR INSERT 
  TO service_role 
  WITH CHECK (true);

CREATE POLICY "Service role can update paper claims" 
  ON paper_claims FOR UPDATE 
  TO service_role 
  USING (true);

CREATE POLICY "Service role can delete paper claims" 
  ON paper_claims FOR DELETE 
  TO service_role 
  USING (true);

-- ============================================================================
-- 8. RESEARCH_GAPS TABLE
-- ============================================================================
-- Research gaps are tied to projects
ALTER TABLE research_gaps ENABLE ROW LEVEL SECURITY;

-- Users can view gaps from their own projects
CREATE POLICY "Users can view own project gaps" 
  ON research_gaps FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM research_projects rp 
      WHERE rp.id = research_gaps.project_id 
      AND rp.user_id = auth.uid()
    )
  );

-- Users can create gaps in their own projects
CREATE POLICY "Users can create gaps in own projects" 
  ON research_gaps FOR INSERT 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM research_projects rp 
      WHERE rp.id = research_gaps.project_id 
      AND rp.user_id = auth.uid()
    )
  );

-- Users can update gaps in their own projects
CREATE POLICY "Users can update gaps in own projects" 
  ON research_gaps FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM research_projects rp 
      WHERE rp.id = research_gaps.project_id 
      AND rp.user_id = auth.uid()
    )
  );

-- Users can delete gaps from their own projects
CREATE POLICY "Users can delete gaps from own projects" 
  ON research_gaps FOR DELETE 
  USING (
    EXISTS (
      SELECT 1 FROM research_projects rp 
      WHERE rp.id = research_gaps.project_id 
      AND rp.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 9. PROJECT_ANALYSIS TABLE
-- ============================================================================
-- Project analysis is tied to projects
ALTER TABLE project_analysis ENABLE ROW LEVEL SECURITY;

-- Users can view analysis from their own projects
CREATE POLICY "Users can view own project analysis" 
  ON project_analysis FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM research_projects rp 
      WHERE rp.id = project_analysis.project_id 
      AND rp.user_id = auth.uid()
    )
  );

-- Users can create analysis in their own projects
CREATE POLICY "Users can create analysis in own projects" 
  ON project_analysis FOR INSERT 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM research_projects rp 
      WHERE rp.id = project_analysis.project_id 
      AND rp.user_id = auth.uid()
    )
  );

-- Users can update analysis in their own projects
CREATE POLICY "Users can update analysis in own projects" 
  ON project_analysis FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM research_projects rp 
      WHERE rp.id = project_analysis.project_id 
      AND rp.user_id = auth.uid()
    )
  );

-- Users can delete analysis from their own projects
CREATE POLICY "Users can delete analysis from own projects" 
  ON project_analysis FOR DELETE 
  USING (
    EXISTS (
      SELECT 1 FROM research_projects rp 
      WHERE rp.id = project_analysis.project_id 
      AND rp.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 10. PROCESSING_LOGS TABLE
-- ============================================================================
-- Processing logs are internal system records
ALTER TABLE processing_logs ENABLE ROW LEVEL SECURITY;

-- Only service role can access processing logs
CREATE POLICY "Service role can view processing logs" 
  ON processing_logs FOR SELECT 
  TO service_role 
  USING (true);

CREATE POLICY "Service role can insert processing logs" 
  ON processing_logs FOR INSERT 
  TO service_role 
  WITH CHECK (true);

CREATE POLICY "Service role can update processing logs" 
  ON processing_logs FOR UPDATE 
  TO service_role 
  USING (true);

CREATE POLICY "Service role can delete processing logs" 
  ON processing_logs FOR DELETE 
  TO service_role 
  USING (true);

-- ============================================================================
-- GRANT PERMISSIONS TO AUTHENTICATED USERS
-- ============================================================================
-- These grants allow authenticated users to execute RPC functions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ============================================================================
-- 11. USER_PREFERENCES TABLE
-- ============================================================================
-- User preferences are personal settings
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_preferences') THEN
    ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Users can view their own preferences
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_preferences') THEN
    EXECUTE 'CREATE POLICY "Users can view own preferences" ON user_preferences FOR SELECT USING (auth.uid() = user_id)';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Users can create their own preferences
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_preferences') THEN
    EXECUTE 'CREATE POLICY "Users can create own preferences" ON user_preferences FOR INSERT WITH CHECK (auth.uid() = user_id)';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Users can update their own preferences
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_preferences') THEN
    EXECUTE 'CREATE POLICY "Users can update own preferences" ON user_preferences FOR UPDATE USING (auth.uid() = user_id)';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Users can delete their own preferences
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_preferences') THEN
    EXECUTE 'CREATE POLICY "Users can delete own preferences" ON user_preferences FOR DELETE USING (auth.uid() = user_id)';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 12. PROJECT_EVIDENCE_USAGE TABLE
-- ============================================================================
-- Evidence usage is tied to projects
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'project_evidence_usage') THEN
    ALTER TABLE project_evidence_usage ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Users can view evidence usage from their own projects
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'project_evidence_usage') THEN
    EXECUTE 'CREATE POLICY "Users can view own project evidence" ON project_evidence_usage FOR SELECT USING (EXISTS (SELECT 1 FROM research_projects rp WHERE rp.id = project_evidence_usage.project_id AND rp.user_id = auth.uid()))';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Users can create evidence usage in their own projects
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'project_evidence_usage') THEN
    EXECUTE 'CREATE POLICY "Users can create evidence in own projects" ON project_evidence_usage FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM research_projects rp WHERE rp.id = project_evidence_usage.project_id AND rp.user_id = auth.uid()))';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Users can update evidence usage in their own projects
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'project_evidence_usage') THEN
    EXECUTE 'CREATE POLICY "Users can update evidence in own projects" ON project_evidence_usage FOR UPDATE USING (EXISTS (SELECT 1 FROM research_projects rp WHERE rp.id = project_evidence_usage.project_id AND rp.user_id = auth.uid()))';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Users can delete evidence usage from their own projects
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'project_evidence_usage') THEN
    EXECUTE 'CREATE POLICY "Users can delete evidence from own projects" ON project_evidence_usage FOR DELETE USING (EXISTS (SELECT 1 FROM research_projects rp WHERE rp.id = project_evidence_usage.project_id AND rp.user_id = auth.uid()))';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 13. CITATIONS TABLE (if exists - legacy table)
-- ============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'citations') THEN
    ALTER TABLE citations ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Service role manages the citations table
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'citations') THEN
    EXECUTE 'CREATE POLICY "Authenticated users can view citations" ON citations FOR SELECT TO authenticated USING (true)';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'citations') THEN
    EXECUTE 'CREATE POLICY "Service role can manage citations" ON citations FOR ALL TO service_role USING (true)';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- GRANT PERMISSIONS TO AUTHENTICATED USERS
-- ============================================================================
-- These grants allow authenticated users to execute RPC functions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ============================================================================
-- VERIFICATION COMMENTS
-- ============================================================================
COMMENT ON POLICY "Users can view own profile" ON profiles IS 'RLS: Users can only view their own profile';
COMMENT ON POLICY "Users can view own projects" ON research_projects IS 'RLS: Users can only view their own projects';
COMMENT ON POLICY "Users can view own library papers" ON library_papers IS 'RLS: Users can only view papers in their library';
COMMENT ON POLICY "Users can view own project citations" ON project_citations IS 'RLS: Users can only view citations from their own projects';
COMMENT ON POLICY "Authenticated users can view papers" ON papers IS 'RLS: Papers are shared resources, readable by all authenticated users';
