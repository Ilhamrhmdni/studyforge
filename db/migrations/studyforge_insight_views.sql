-- STUDYFORGE INSIGHT VIEWS (MVP)

-- 1. View untuk Statistik Kesulitan Soal (Admin Insight)
-- Mengagregasi data dari quiz_attempt_answers dan quizzes
CREATE OR REPLACE VIEW public.question_stats_view AS
SELECT 
  qaa.quiz_id,
  qa.quiz_title,
  COALESCE(q.subject, q.title) AS subject,
  qaa.question_num,
  COUNT(qaa.id) AS total_attempts,
  SUM(CASE WHEN qaa.is_correct THEN 1 ELSE 0 END) AS correct_count,
  SUM(CASE WHEN qaa.is_correct THEN 0 ELSE 1 END) AS wrong_count,
  CAST(SUM(CASE WHEN qaa.is_correct THEN 1 ELSE 0 END) AS FLOAT) / COUNT(qaa.id) AS correct_rate,
  CASE
    WHEN COUNT(qaa.id) < 5 THEN 'Data Kurang'
    WHEN CAST(SUM(CASE WHEN qaa.is_correct THEN 1 ELSE 0 END) AS FLOAT) / COUNT(qaa.id) < 0.20 THEN 'Bermasalah'
    WHEN CAST(SUM(CASE WHEN qaa.is_correct THEN 1 ELSE 0 END) AS FLOAT) / COUNT(qaa.id) < 0.40 THEN 'Sulit'
    WHEN CAST(SUM(CASE WHEN qaa.is_correct THEN 1 ELSE 0 END) AS FLOAT) / COUNT(qaa.id) < 0.75 THEN 'Sedang'
    ELSE 'Mudah'
  END AS status
FROM 
  public.quiz_attempt_answers qaa
JOIN 
  public.quiz_attempts qa ON qaa.attempt_id = qa.id
JOIN 
  public.quizzes q ON qa.quiz_id = q.id
GROUP BY 
  qaa.quiz_id, qa.quiz_title, q.subject, q.title, qaa.question_num;

-- RLS tidak bisa diaplikasikan langsung ke View biasa dengan cara yang sama seperti tabel, 
-- tapi View ini akan dipanggil oleh backend Cloudflare Workers yang menggunakan Service Role,
-- atau karena kita fetch pake auth user, kita pastikan aksesnya aman dari backend.


-- 2. View untuk Statistik Kelemahan Siswa (User Insight)
-- Mengagregasi performa siswa berdasarkan mata pelajaran (subject)
CREATE OR REPLACE VIEW public.user_subject_stats_view AS
SELECT 
  qaa.user_id,
  COALESCE(q.subject, q.title) AS subject,
  COUNT(qaa.id) AS total_answered,
  SUM(CASE WHEN qaa.is_correct THEN 1 ELSE 0 END) AS correct_count,
  SUM(CASE WHEN qaa.is_correct THEN 0 ELSE 1 END) AS wrong_count,
  CAST(SUM(CASE WHEN qaa.is_correct THEN 1 ELSE 0 END) AS FLOAT) / COUNT(qaa.id) AS accuracy_rate,
  MAX(qa.submitted_at) AS last_attempt_at
FROM 
  public.quiz_attempt_answers qaa
JOIN 
  public.quiz_attempts qa ON qaa.attempt_id = qa.id
JOIN 
  public.quizzes q ON qa.quiz_id = q.id
GROUP BY 
  qaa.user_id, COALESCE(q.subject, q.title);
