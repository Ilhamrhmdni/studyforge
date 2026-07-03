-- 1. PARSE JOBS
CREATE TABLE IF NOT EXISTS public.parse_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id),
  file_name TEXT,
  file_size BIGINT,
  page_count INT,
  parser_method TEXT DEFAULT 'client_gemini_byok',
  status TEXT DEFAULT 'processing',
  detected_question_count INT DEFAULT 0,
  detected_answer_key_count INT DEFAULT 0,
  validation_status TEXT,
  validation_errors JSONB DEFAULT '[]'::jsonb,
  analytics_consent BOOLEAN DEFAULT false,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE IF EXISTS public.parse_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own parse jobs" ON public.parse_jobs;
CREATE POLICY "Users can view own parse jobs" ON public.parse_jobs FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all parse jobs" ON public.parse_jobs;
CREATE POLICY "Admins can view all parse jobs" ON public.parse_jobs FOR SELECT USING ( (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin' );

-- 2. PARSE RESULTS
CREATE TABLE IF NOT EXISTS public.parse_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parse_job_id UUID REFERENCES public.parse_jobs(id) ON DELETE CASCADE,
  raw_ai_output JSONB,
  normalized_output JSONB,
  final_user_corrected_output JSONB,
  correction_summary JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE IF EXISTS public.parse_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own parse results" ON public.parse_results;
CREATE POLICY "Users can view own parse results" ON public.parse_results FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.parse_jobs WHERE id = parse_job_id AND user_id = auth.uid())
);

DROP POLICY IF EXISTS "Admins can view all parse results" ON public.parse_results;
CREATE POLICY "Admins can view all parse results" ON public.parse_results FOR SELECT USING ( (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin' );

-- 3. PARSE FEEDBACK
CREATE TABLE IF NOT EXISTS public.parse_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parse_job_id UUID REFERENCES public.parse_jobs(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id),
  question_number INT,
  feedback_type TEXT,
  rating INT,
  before_value JSONB,
  after_value JSONB,
  user_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE IF EXISTS public.parse_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own feedback" ON public.parse_feedback;
CREATE POLICY "Users can view own feedback" ON public.parse_feedback FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all feedback" ON public.parse_feedback;
CREATE POLICY "Admins can view all feedback" ON public.parse_feedback FOR SELECT USING ( (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin' );


-- 4. CREATOR USAGE LOGS
CREATE TABLE IF NOT EXISTS public.creator_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id),
  action TEXT,
  file_name TEXT,
  file_size BIGINT,
  page_count INT,
  question_count INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE IF EXISTS public.creator_usage_logs ENABLE ROW LEVEL SECURITY;

-- Note: Usage logs are mainly for backend checks, we can allow users to view their own if needed
DROP POLICY IF EXISTS "Users can view own usage logs" ON public.creator_usage_logs;
CREATE POLICY "Users can view own usage logs" ON public.creator_usage_logs FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins can view all usage logs" ON public.creator_usage_logs;
CREATE POLICY "Admins can view all usage logs" ON public.creator_usage_logs FOR SELECT USING ( (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin' );


-- 5. QUIZZES MODIFICATION
ALTER TABLE public.quizzes
ADD COLUMN IF NOT EXISTS creator_id UUID REFERENCES public.profiles(id),
ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'official',
ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'public',
ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'approved',
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id),
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
ADD COLUMN IF NOT EXISTS parser_job_id UUID REFERENCES public.parse_jobs(id);

-- Fix quizzes visibility policies
-- Remove old policies that allow viewing everything
DROP POLICY IF EXISTS "Anyone can view quizzes" ON public.quizzes;

-- 1. Anyone can view public quizzes
CREATE POLICY "Anyone can view public quizzes" ON public.quizzes 
FOR SELECT USING (visibility = 'public' AND is_hidden = false);

-- 2. Users can view their own private quizzes
CREATE POLICY "Users can view own private quizzes" ON public.quizzes 
FOR SELECT USING (creator_id = auth.uid());

-- 3. Admins can view everything
CREATE POLICY "Admins can view all quizzes" ON public.quizzes 
FOR SELECT USING ( (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin' );
