# Cloudflare Stage 1 Audit for StudyForge

Tanggal audit: 2026-07-04
Branch audit: `redesign/dashboard-sidebar`

## Ringkasan

Cloudflare paling cocok dipakai di StudyForge tahap 1 sebagai lapisan:

- proteksi abuse
- rate limiting
- cache policy
- analytics publik
- rencana storage object untuk screenshot

Tanpa mengubah fitur besar, prioritas paling aman adalah:

1. Turnstile untuk endpoint yang sudah lewat backend StudyForge
2. WAF rate limiting via dashboard Cloudflare
3. Cache Rules dan HTML no-cache untuk route private
4. Web Analytics untuk landing dan route publik
5. Rencana migrasi screenshot bug report ke R2

## Kondisi repo saat ini

### Sudah cocok untuk proteksi backend

Endpoint berikut sudah lewat Cloudflare Pages Functions, jadi cocok diberi Turnstile server-side dan rate limiting:

- `/api/ai/explain-question`
- `/api/report-bug`
- `/api/user/init-parse-job`
- `/api/submit-quiz`

### Belum ideal untuk Turnstile auth

Login dan register saat ini langsung memakai Supabase client SDK dari browser:

- `public/js/pages/login.js`
  - `sb.auth.signInWithPassword(...)`
  - `sb.auth.signUp(...)`

Artinya, Turnstile untuk login/register **belum bisa ditegakkan aman** tanpa menambah endpoint auth proxy atau flow verifikasi server-side sebelum auth dilanjutkan.

## 1. Turnstile audit

### A. Login/register

Status: `medium complexity`, bukan kandidat terbaik untuk tahap 1 jika ingin tetap minim perubahan.

Alasan:

- Cloudflare Turnstile mewajibkan server-side validation.
- StudyForge login/register sekarang langsung ke Supabase dari browser.
- Kalau widget hanya dipasang di client tanpa verifikasi server-side, proteksinya tidak valid.

Rekomendasi tahap 1:

- Jangan implement auth Turnstile dulu jika targetnya benar-benar minim perubahan.
- Gunakan Cloudflare WAF rate limiting untuk halaman auth dan endpoint terkait sebagai mitigasi awal.

Rekomendasi tahap 2:

- Tambahkan endpoint auth proxy kecil di Pages Functions:
  - verifikasi token Turnstile
  - baru lanjutkan proses auth ke Supabase

Sumber:

- Turnstile overview: https://developers.cloudflare.com/turnstile/
- Turnstile security requirement: https://developers.cloudflare.com/turnstile/get-started/
- Server-side validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

### B. Report bug

Status: `high value`, kandidat terbaik tahap 1.

Alasan:

- Endpoint sudah lewat Pages Function: `functions/api/report-bug.js`
- Endpoint menerima input teks dan screenshot
- Abuse cost relatif nyata: spam report dan payload besar

Rekomendasi:

- Tambahkan widget Turnstile di modal bug report
- Kirim token bersama request `/api/report-bug`
- Verifikasi token di backend sebelum insert ke database

Nilai implementasi:

- risiko rendah
- perubahan scope kecil
- perlindungan langsung terasa

### C. AI explanation endpoint

Status: `high value`, kandidat terbaik tahap 1.

Alasan:

- Endpoint memicu biaya inference
- Sudah ada quota aplikasi, tapi masih layak ditambah proteksi edge
- Endpoint cocok untuk kombinasi:
  - Turnstile
  - WAF rate limiting

Rekomendasi:

- Tambahkan Turnstile sebelum request AI pertama per sesi hasil
- Validasi token pada `/api/ai/explain-question`
- Tetap pertahankan quota aplikasi yang sekarang

### D. Parse job endpoint

Status: `optional but useful`.

Alasan:

- Sudah ada quota internal 3 upload/hari
- Namun endpoint tetap cocok diberi WAF rate limit
- Turnstile bisa ditambahkan jika abuse mulai terlihat

Rekomendasi tahap 1:

- cukup WAF rate limit dulu
- Turnstile opsional

## 2. WAF / Rate limiting recommendation

Gunakan Cloudflare WAF Rate Limiting Rules di dashboard, jangan hardcode ke app dulu.

Sumber:

- Overview: https://developers.cloudflare.com/waf/
- Rate limiting rules: https://developers.cloudflare.com/waf/rate-limiting-rules/
- Best practices: https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/
- Create in dashboard: https://developers.cloudflare.com/waf/rate-limiting-rules/create-zone-dashboard/

### Rule set yang disarankan

#### Rule 1: AI explanation

Path:

- `/api/ai/explain-question`

Saran awal:

- threshold: `10 requests / 1 minute / IP`
- action: `Managed Challenge`

Kenapa:

- cukup longgar untuk user normal
- cukup ketat untuk script abuse

Rule lanjutan opsional:

- `30 requests / 10 minutes / IP`
- action: `Block` atau `Managed Challenge`

#### Rule 2: Bug report

Path:

- `/api/report-bug`

Saran awal:

- `5 requests / 10 minutes / IP`
- action: `Managed Challenge`

Kenapa:

- user normal jarang kirim berkali-kali
- spam report akan cepat tertahan

#### Rule 3: Parse job init

Path:

- `/api/user/init-parse-job`

Saran awal:

- `5 requests / 10 minutes / IP`
- action: `Managed Challenge`

Catatan:

- aplikasi sudah punya quota user-level
- rule ini menjadi edge protection tambahan terhadap abuse IP

#### Rule 4: Submit quiz

Path:

- `/api/submit-quiz`

Saran awal:

- `20 requests / 5 minutes / IP`
- action: `Managed Challenge`

Kenapa:

- submit quiz tidak boleh terlalu ketat karena ada auto retry / user race
- tapi tetap perlu batas supaya tidak dipakai flood

### Rule auth page tambahan

Karena login/register belum memakai Turnstile server-side, pertimbangkan rule ringan:

- path `/masuk`
- path `/daftar`
- threshold kecil untuk brute-force browsing abuse
- action `Managed Challenge`

Catatan:

- ini bukan pengganti auth protection penuh
- ini hanya mitigasi edge awal

## 3. Cache Rules recommendation

Sumber:

- Cache Rules overview: https://developers.cloudflare.com/cache/how-to/cache-rules/
- Cache Rules settings: https://developers.cloudflare.com/cache/how-to/cache-rules/settings/
- Create in dashboard: https://developers.cloudflare.com/cache/how-to/cache-rules/create-dashboard/

### A. Bypass cache untuk API

Rule:

- match: `http.request.uri.path starts_with "/api/"`
- action: `Bypass cache`

Ini wajib.

### B. Jangan cache HTML private / auth-sensitive

Rule:

- `/dashboard*`
- `/paket-soal*`
- `/tryout*`
- `/koleksi*`
- `/admin*`
- `/creator*`
- `/quiz*`
- `/result*`
- `/insight*`
- `/riwayat*`
- `/history*`
- `/masuk`
- `/daftar`
- `/login*`

Action:

- `Bypass cache`

Kenapa:

- halaman-halaman ini sensitif terhadap state auth/session
- HTML stale bisa membingungkan user

### C. Static assets boleh lebih agresif

Target:

- `/css/*`
- `/js/*`
- font/image asset bila nanti ada

Action:

- cache enabled
- Edge TTL tinggi, misalnya `1 month`

Catatan:

- karena file saat ini sudah punya versi query di beberapa tempat, ini cocok untuk static caching

### D. Halaman publik

Landing `/` boleh tetap mengikuti default dulu.

Jika nanti ingin lebih agresif:

- cache landing HTML dengan TTL pendek
- tapi bukan prioritas tahap 1

## 4. Web Analytics plan

Target tahap 1:

- landing page `/`
- route publik marketing

Sumber:

- Web Analytics docs: https://developers.cloudflare.com/web-analytics/get-started/
- Pages docs: https://developers.cloudflare.com/pages/how-to/web-analytics/
- Data collection note: https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/

### Rekomendasi pemasangan

Karena site ini berjalan di Cloudflare Pages:

- coba dulu automatic setup dari dashboard Web Analytics
- jika otomatis tidak muncul, pakai snippet manual

Route fokus pengamatan:

- `/`
- `/masuk`
- `/daftar`
- `/paket-soal`
- `/tryout`

### Langkah dashboard

1. Cloudflare Dashboard
2. Web Analytics
3. Add a site
4. Pilih hostname Pages project
5. Gunakan automatic setup bila tersedia

### Jika perlu snippet manual

Tambahkan snippet hanya ke halaman publik/marketing terlebih dulu:

- `public/index.html`
- opsional `public/login.html`

Belum perlu dipasang di seluruh app route jika fokus analitik tahap 1 masih acquisition funnel.

### Catatan CSP

Jika nanti menambahkan CSP, izinkan:

- `https://static.cloudflareinsights.com`

## 5. R2 migration plan untuk screenshot bug report

Status: `recommended`, tapi **jangan implement dulu** sebelum approval.

Masalah sekarang:

- screenshot masih base64 di database
- payload membesar
- query admin bisa berat

Sumber:

- R2 Workers usage: https://developers.cloudflare.com/r2/api/workers/workers-api-usage/
- Presigned URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- Reference architecture user-generated content: https://developers.cloudflare.com/reference-architecture/diagrams/storage/storing-user-generated-content/

### Target desain

Simpan metadata di database, simpan binary di R2.

### Rencana migrasi

#### Tahap A: Schema baru

Tambahkan kolom baru di `bug_reports`:

- `screenshot_key`
- `screenshot_url` atau `screenshot_variant`
- `screenshot_size_bytes`
- `screenshot_content_type`

Biarkan `screenshot_data_url` tetap ada sementara untuk backward compatibility.

#### Tahap B: Upload flow baru

Opsi paling aman:

1. Frontend minta upload URL sementara ke Pages Function
2. Worker membuat signed PUT URL
3. Frontend upload langsung ke R2
4. Setelah sukses, frontend submit report dengan `screenshot_key`

Keuntungan:

- Worker tidak perlu memproses payload gambar besar
- DB tetap kecil

#### Tahap C: Read flow admin

- list admin hanya ambil metadata
- detail report baru fetch URL/object jika dibutuhkan

#### Tahap D: Backfill

- script migrasi membaca `screenshot_data_url` lama
- upload ke R2
- isi `screenshot_key`
- lalu kosongkan kolom base64 lama bertahap

### Bucket design

Contoh prefix:

- `bug-reports/{report_id}/original.png`

Atau:

- `bug-reports/{yyyy}/{mm}/{report_id}.jpg`

### Access model

Tahap 1 yang aman:

- bucket private
- akses melalui Worker/admin endpoint

Jangan langsung public bucket untuk screenshot bug report.

## Prioritas implementasi yang disarankan

### Sprint 1

1. WAF rate limiting rules di dashboard
2. Cache Rules untuk `/api/*` dan route private
3. Web Analytics untuk landing/public route

### Sprint 2

1. Turnstile pada `/api/report-bug`
2. Turnstile pada `/api/ai/explain-question`

### Sprint 3

1. Auth proxy design untuk login/register bila Turnstile auth benar-benar dibutuhkan
2. R2 migration untuk screenshot bug report

## Verdict

Peluang penggunaan Cloudflare di StudyForge sangat bagus untuk tahap 1, khususnya sebagai:

- abuse protection layer
- cache policy layer
- observability layer

Nilai implementasi tercepat:

- Cloudflare WAF rules
- Cache Rules
- Web Analytics

Nilai implementasi aplikasi paling efektif:

- Turnstile untuk `report-bug`
- Turnstile untuk `ai/explain-question`

Yang sebaiknya ditunda sampai ada approval desain:

- Turnstile untuk login/register
- migrasi screenshot ke R2
