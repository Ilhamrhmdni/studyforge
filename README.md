# StudyForge

Platform latihan soal interaktif dengan:
- frontend statis di `public/`
- Cloudflare Pages Functions di `functions/`
- database/auth di Supabase

## Struktur

```text
studyforge/
├── functions/              # Cloudflare Pages Functions
├── public/                 # Static assets / HTML
├── wrangler.jsonc          # Konfigurasi Cloudflare Pages
├── supabase_schema.sql     # Referensi schema / policy
└── migrate_secure_quizzes.mjs
```

## Deploy Gratis ke Cloudflare Pages

1. Push repo ini ke GitHub.
2. Di Cloudflare Dashboard buka `Workers & Pages`.
3. Klik `Create application` > `Pages` > `Connect to Git`.
4. Pilih repo `studyforge`.
5. Build settings:
   - Build command: kosongkan
   - Build output directory: `public`
6. Deploy.

Cloudflare Pages akan otomatis membaca:
- static site dari `public/`
- serverless endpoint dari `functions/`

## Environment Variables

Set di Cloudflare Pages project:

```text
SUPABASE_URL=https://wsmclqrqfhrzysxgmfdj.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
QUIZ_ENCRYPTION_SECRET=...
```

`QUIZ_ENCRYPTION_SECRET` harus stabil. Jangan diganti sembarangan setelah quiz terenkripsi mulai dipakai.

## Route Penting

- `/` daftar quiz
- `/admin` dashboard admin
- `/quiz?id=...` halaman ujian
- `/result?id=...` halaman hasil
- `/api/quizzes`
- `/api/quiz`
- `/api/submit-quiz`
- `/api/admin/save-quiz`

## Migrasi Quiz Lama

Setelah env siap, jalankan lokal:

```bash
node migrate_secure_quizzes.mjs
```

Script ini akan mengenkripsi jawaban quiz lama yang masih tersimpan plaintext.
