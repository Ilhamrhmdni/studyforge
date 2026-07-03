-- Tabel untuk rate limiting AI pembahasan soal
-- Maks 20 request per user per hari
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  request_count INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_id, usage_date)
);

-- Increment counter menggunakan upsert
-- Fungsi ini dipanggil otomatis oleh backend saat user request AI
CREATE OR REPLACE FUNCTION increment_ai_usage(p_user_id UUID, p_date DATE)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.ai_usage_logs (user_id, usage_date, request_count)
  VALUES (p_user_id, p_date, 1)
  ON CONFLICT (user_id, usage_date)
  DO UPDATE SET
    request_count = ai_usage_logs.request_count + 1,
    updated_at = now();
END;
$$;

-- RLS: User hanya bisa lihat data miliknya sendiri
ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage" ON public.ai_usage_logs
  FOR SELECT USING (auth.uid() = user_id);
