-- STUDYFORGE SUPABASE SCHEMA

-- 1. PROFILES (Auto-created on user signup via trigger)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'student',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Trigger to automatically create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name', 'student');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists to prevent errors on re-run
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 2. QUIZZES / QUIZ_PACKAGES (Existing table for Admin)
-- Assumes you already have a `quizzes` table. We just ensure RLS allows read-only for students.
ALTER TABLE IF EXISTS public.quizzes ENABLE ROW LEVEL SECURITY;

-- Allow anyone (or just authenticated users) to read published quizzes
DROP POLICY IF EXISTS "Anyone can view quizzes" ON public.quizzes;
CREATE POLICY "Anyone can view quizzes" ON public.quizzes FOR SELECT USING (true);

-- 3. QUIZ ATTEMPTS (Replaces old 'results' table for students)
CREATE TABLE IF NOT EXISTS public.quiz_attempts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  quiz_id TEXT NOT NULL,
  quiz_title TEXT NOT NULL,
  score INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  total INTEGER NOT NULL,
  time_taken INTEGER NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own attempts" ON public.quiz_attempts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own attempts" ON public.quiz_attempts FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 4. QUIZ ATTEMPT ANSWERS (Detailed answers for review)
CREATE TABLE IF NOT EXISTS public.quiz_attempt_answers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  attempt_id UUID REFERENCES public.quiz_attempts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  question_num INTEGER NOT NULL,
  question_text TEXT,
  options JSONB,
  correct_answer TEXT,
  user_answer TEXT,
  is_correct BOOLEAN NOT NULL
);

ALTER TABLE public.quiz_attempt_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own answers" ON public.quiz_attempt_answers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own answers" ON public.quiz_attempt_answers FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 5. ADMIN POLICIES
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING ( (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin' );
CREATE POLICY "Admins can update all profiles" ON public.profiles FOR UPDATE USING ( (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin' );

CREATE POLICY "Admins can insert quizzes" ON public.quizzes FOR INSERT WITH CHECK ( (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin' );
CREATE POLICY "Admins can update quizzes" ON public.quizzes FOR UPDATE USING ( (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin' );
CREATE POLICY "Admins can delete quizzes" ON public.quizzes FOR DELETE USING ( (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin' );

CREATE POLICY "Admins can view all attempts" ON public.quiz_attempts FOR SELECT USING ( (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin' );
CREATE POLICY "Admins can delete attempts" ON public.quiz_attempts FOR DELETE USING ( (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin' );

-- Sync existing auth.users to profiles
INSERT INTO public.profiles (id, email, role)
SELECT id, email, 'student' FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- Make ilhamrahmaddani550@gmail.com an admin
UPDATE public.profiles SET role = 'admin' WHERE email = 'ilhamrahmaddani550@gmail.com';
