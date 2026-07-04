# Cloudflare Stage 1 Runbook

## Prinsip eksekusi

- Jangan aktifkan semua rule sekaligus.
- Aktifkan satu rule, test, baru lanjut rule berikutnya.
- Test di custom domain/zone yang benar.
- Preview `pages.dev` tidak selalu merepresentasikan rule custom domain.
- Jangan aktifkan static asset aggressive cache dulu.

## Langkah 1 — Web Analytics

### Menu dashboard

1. Login ke Cloudflare Dashboard
2. Buka `Analytics & Logs`
3. Buka `Web Analytics`
4. Klik `Add a site`

### Langkah klik

1. Pilih site/hostname StudyForge yang ingin dipantau
2. Jika ada opsi `Automatic setup` untuk Pages, pilih itu dulu
3. Klik `Enable` atau `Save`
4. Tunggu beberapa menit sampai konfigurasi aktif

### Hostname yang dipilih

Pilih hostname custom domain production yang benar.

Contoh:

- `temtaskor.com`
- `www.temtaskor.com`

Jangan mengandalkan `pages.dev` sebagai validasi utama.

### Cara validasi hit

1. Buka site publik di custom domain
2. Kunjungi:
   - `/`
   - `/masuk`
   - `/daftar`
   - `/paket-soal`
3. Tunggu beberapa menit
4. Kembali ke dashboard Web Analytics
5. Cek apakah pageviews mulai muncul

### Expected result

- hit mulai terlihat di dashboard analytics
- route publik mulai terukur
- tidak ada gangguan ke halaman aplikasi

### Rollback / disable jika perlu

1. Kembali ke `Analytics & Logs`
2. Buka `Web Analytics`
3. Pilih site yang tadi diaktifkan
4. Disable tracking atau hapus site dari Web Analytics

## Langkah 2 — Cache Rule: Bypass /api/*

### Menu dashboard

1. Buka Cloudflare Dashboard
2. Pilih zone/domain StudyForge
3. Buka `Caching`
4. Buka `Cache Rules`
5. Klik `Create rule`

### Nama rule

- `studyforge-bypass-api`

### Expression copy-paste

```text
starts_with(http.request.uri.path, "/api/")
```

### Action

- `Bypass cache`

### Cara test

1. Buka custom domain StudyForge
2. Akses endpoint API dari browser atau app flow normal
3. Tes minimal:
   - `/api/quizzes`
   - flow submit bug report
   - flow AI explanation
   - flow init parse job
   - flow submit quiz

### Expected result

- API tetap fresh
- response API tidak disajikan dari cache HTML
- flow aplikasi tetap berjalan normal

### Rollback

1. Buka `Caching`
2. Buka `Cache Rules`
3. Cari rule `studyforge-bypass-api`
4. Disable rule atau delete rule

## Langkah 3 — Cache Rule: Bypass private/auth HTML

### Menu dashboard

1. Buka Cloudflare Dashboard
2. Pilih zone/domain StudyForge
3. Buka `Caching`
4. Buka `Cache Rules`
5. Klik `Create rule`

### Nama rule

- `studyforge-bypass-private-html`

### Expression copy-paste

```text
http.request.uri.path in {
  "/dashboard"
  "/dashboard.html"
  "/paket-soal"
  "/tryout"
  "/koleksi"
  "/admin"
  "/admin.html"
  "/creator"
  "/creator.html"
  "/insight"
  "/insight.html"
  "/riwayat"
  "/history"
  "/history.html"
  "/masuk"
  "/daftar"
  "/login"
  "/login.html"
  "/quiz.html"
  "/result.html"
}
or starts_with(http.request.uri.path, "/quiz")
or starts_with(http.request.uri.path, "/result")
```

### Action

- `Bypass cache`

### Cara test

1. Buka custom domain StudyForge
2. Login normal
3. Kunjungi:
   - `/dashboard`
   - `/koleksi`
   - `/insight`
   - `/riwayat`
   - `/creator`
   - `/admin`
   - `/quiz?id=...`
   - `/result?id=...`
4. Refresh beberapa kali pada halaman-halaman itu
5. Pastikan state auth dan isi halaman tetap sesuai user saat ini

### Expected result

- HTML private/auth tidak stale
- halaman tidak menyajikan snapshot lama dari user/session sebelumnya
- login/logout state tetap konsisten

### Rollback

1. Buka `Caching`
2. Buka `Cache Rules`
3. Cari `studyforge-bypass-private-html`
4. Disable rule atau delete rule

## Langkah 4 — WAF: /api/report-bug

### Menu dashboard

1. Buka Cloudflare Dashboard
2. Pilih zone/domain StudyForge
3. Buka `Security`
4. Buka `WAF`
5. Buka `Rate limiting rules`
6. Klik `Create rule`

### Rule name

- `studyforge-report-bug`

### Match condition

- Field: `URI Path`
- Operator: `equals`
- Value: `/api/report-bug`

### Threshold

- Requests: `5`
- Period: `10 minutes`

### Action

- `Managed Challenge`

### Counting characteristic

- `IP`

### Test normal report bug

1. Login ke app dari custom domain
2. Buka halaman quiz
3. Kirim report bug normal
4. Coba report tanpa screenshot dan dengan screenshot kecil

### Expected response tetap JSON normal

- report bug berhasil dikirim
- frontend tetap menerima response JSON normal
- tidak ada error karena menerima halaman challenge HTML

### Rollback

- disable rule `studyforge-report-bug`
- atau longgarkan threshold jika terlalu agresif

## Langkah 5 — WAF: /api/ai/explain-question

### Menu dashboard

1. Buka Cloudflare Dashboard
2. Pilih zone/domain StudyForge
3. Buka `Security`
4. Buka `WAF`
5. Buka `Rate limiting rules`
6. Klik `Create rule`

### Rule name

- `studyforge-ai-explain`

### Match condition

- Field: `URI Path`
- Operator: `equals`
- Value: `/api/ai/explain-question`

### Threshold

- Requests: `10`
- Period: `1 minute`

### Action

- `Managed Challenge`

### Counting characteristic

- `IP`

### Test AI explanation dari result page

1. Login normal
2. Buka halaman result dari custom domain
3. Klik AI explanation pada jawaban yang salah
4. Ulangi beberapa kali dalam batas normal

### Expected response tetap JSON normal

- AI explanation tetap muncul normal
- frontend menerima JSON normal
- tidak ada response challenge HTML ke request `fetch()`

### Rollback

- disable rule `studyforge-ai-explain`
- atau longgarkan threshold jika user normal ikut kena

## Langkah 6 — WAF: /api/user/init-parse-job

### Menu dashboard

1. Buka Cloudflare Dashboard
2. Pilih zone/domain StudyForge
3. Buka `Security`
4. Buka `WAF`
5. Buka `Rate limiting rules`
6. Klik `Create rule`

### Rule name

- `studyforge-init-parse-job`

### Match condition

- Field: `URI Path`
- Operator: `equals`
- Value: `/api/user/init-parse-job`

### Threshold

- Requests: `5`
- Period: `10 minutes`

### Action

- `Managed Challenge`

### Counting characteristic

- `IP`

### Test Creator PDF upload/init parse

1. Login normal
2. Buka `/creator`
3. Jalankan flow upload PDF sampai init parse
4. Pastikan request init parse berhasil

### Expected result

- init parse job tetap berjalan
- Creator flow tidak terganggu

### Rollback

- disable rule `studyforge-init-parse-job`
- atau longgarkan threshold

## Langkah 7 — WAF: /api/submit-quiz

### Menu dashboard

1. Buka Cloudflare Dashboard
2. Pilih zone/domain StudyForge
3. Buka `Security`
4. Buka `WAF`
5. Buka `Rate limiting rules`
6. Klik `Create rule`

### Rule name

- `studyforge-submit-quiz`

### Match condition

- Field: `URI Path`
- Operator: `equals`
- Value: `/api/submit-quiz`

### Threshold

- Requests: `20`
- Period: `5 minutes`

### Action

- `Managed Challenge`

### Counting characteristic

- `IP`

### Test submit quiz normal

1. Login normal
2. Kerjakan quiz dari custom domain
3. Submit quiz seperti biasa
4. Pastikan redirect ke result tetap berjalan

### Expected submit tidak terganggu

- submit quiz sukses
- hasil tersimpan
- redirect ke result tetap normal

### Rollback

- disable rule `studyforge-submit-quiz`
- atau longgarkan threshold jika submit normal ikut gagal

## Section final — QA setelah semua aktif

### Route yang dites

- `/`
- `/masuk`
- `/daftar`
- `/dashboard`
- `/koleksi`
- `/insight`
- `/riwayat`
- `/creator`
- `/admin`
- `/quiz?id=...`
- `/result?id=...`

### Endpoint flow yang dites

- submit bug report
- AI explanation
- init parse job
- submit quiz

## Section final — Yang tetap ditunda

- Turnstile login/register
- R2 screenshot migration
- auth proxy
- static asset aggressive cache `/css/*` dan `/js/*`
