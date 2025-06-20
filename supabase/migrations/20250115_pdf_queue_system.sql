-- PDF Processing Queue System Tables

-- User quotas for cost control
CREATE TABLE IF NOT EXISTS user_quotas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_pdf_limit integer DEFAULT 50,
  daily_pdf_used integer DEFAULT 0,
  monthly_ocr_limit integer DEFAULT 10,
  monthly_ocr_used integer DEFAULT 0,
  last_reset timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id)
);

-- PDF processing job logs
CREATE TABLE IF NOT EXISTS pdf_processing_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id text UNIQUE NOT NULL,
  paper_id uuid REFERENCES papers(id) ON DELETE CASCADE,
  pdf_url text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'poisoned')),
  attempts integer DEFAULT 0,
  error_message text,
  extraction_result jsonb,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_quotas_user_id ON user_quotas(user_id);
CREATE INDEX IF NOT EXISTS idx_pdf_logs_job_id ON pdf_processing_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_pdf_logs_status ON pdf_processing_logs(status);
CREATE INDEX IF NOT EXISTS idx_pdf_logs_pdf_url ON pdf_processing_logs(pdf_url);
CREATE INDEX IF NOT EXISTS idx_pdf_logs_user_id ON pdf_processing_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_pdf_logs_created_at ON pdf_processing_logs(created_at);

-- RLS policies
ALTER TABLE user_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_processing_logs ENABLE ROW LEVEL SECURITY;

-- Users can read/update their own quota
CREATE POLICY "Users can read own quota" 
ON user_quotas FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

CREATE POLICY "Users can update own quota" 
ON user_quotas FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id);

-- Users can read their own processing logs
CREATE POLICY "Users can read own processing logs" 
ON pdf_processing_logs FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

-- Service role can manage all records
CREATE POLICY "Service role full access to quotas" 
ON user_quotas FOR ALL 
TO service_role 
USING (true);

CREATE POLICY "Service role full access to logs" 
ON pdf_processing_logs FOR ALL 
TO service_role 
USING (true);

-- Function to reset daily quotas
CREATE OR REPLACE FUNCTION reset_daily_quotas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE user_quotas 
  SET daily_pdf_used = 0, last_reset = now()
  WHERE last_reset < (now() - interval '1 day');
END;
$$;

-- Function to reset monthly quotas
CREATE OR REPLACE FUNCTION reset_monthly_quotas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE user_quotas 
  SET monthly_ocr_used = 0
  WHERE extract(day from last_reset) = 1 
  AND last_reset < (now() - interval '1 month');
END;
$$;

-- Comments for documentation
COMMENT ON TABLE user_quotas IS 'User quotas for PDF processing and OCR usage';
COMMENT ON TABLE pdf_processing_logs IS 'Logs for PDF processing jobs with status tracking';
COMMENT ON FUNCTION reset_daily_quotas() IS 'Resets daily PDF quotas for all users';
COMMENT ON FUNCTION reset_monthly_quotas() IS 'Resets monthly OCR quotas for all users'; 