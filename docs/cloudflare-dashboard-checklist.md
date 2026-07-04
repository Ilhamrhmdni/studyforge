# Cloudflare Dashboard Checklist for StudyForge Stage 1

Tujuan checklist ini:

- menyiapkan proteksi abuse dasar
- memastikan cache aman untuk route app/private
- menyalakan analytics publik

Scope checklist ini sengaja **tanpa**:

- Turnstile login/register
- auth proxy
- migrasi R2
- perubahan backend besar

Branch referensi: `redesign/dashboard-sidebar`

## Sebelum mulai

Pastikan Anda tahu:

- zone/domain yang dipakai untuk StudyForge di Cloudflare
- Pages project yang aktif
- hostname preview/production yang ingin dipantau

## 1. WAF Rate Limiting Rules

Dokumentasi acuan:

- https://developers.cloudflare.com/waf/rate-limiting-rules/

### Lokasi menu

1. Masuk ke Cloudflare Dashboard
2. Pilih domain/zone StudyForge
3. Buka `Security`
4. Buka `WAF`
5. Buka `Rate limiting rules`
6. Klik `Create rule`

### Rule 1: AI explanation

Tujuan:

- membatasi abuse ke endpoint AI yang berbiaya

Isi rule:

- Rule name: `studyforge-ai-explain`
- Field: `URI Path`
- Operator: `equals`
- Value: `/api/ai/explain-question`

Threshold:

- Requests: `10`
- Period: `1 minute`

Action:

- `Managed Challenge`

Simpan rule.

Catatan penting:

- karena endpoint ini dipanggil via `fetch()`, `Managed Challenge` wajib dites setelah rule aktif
- jika challenge muncul ke request normal, frontend bisa menerima HTML/challenge alih-alih JSON
- jika itu terjadi, longgarkan threshold dulu sebelum mempertimbangkan `Block`

### Rule 2: Bug report

Tujuan:

- menahan spam report dan payload abuse

Isi rule:

- Rule name: `studyforge-report-bug`
- Field: `URI Path`
- Operator: `equals`
- Value: `/api/report-bug`

Threshold:

- Requests: `5`
- Period: `10 minutes`

Action:

- `Managed Challenge`

Simpan rule.

Catatan penting:

- endpoint ini juga dipanggil via `fetch()`
- setelah rule aktif, tes report bug normal dari browser
- jika response yang diterima bukan JSON, turunkan agresivitas rule

### Rule 3: Parse job init

Tujuan:

- memberi edge protection tambahan selain quota aplikasi

Isi rule:

- Rule name: `studyforge-init-parse-job`
- Field: `URI Path`
- Operator: `equals`
- Value: `/api/user/init-parse-job`

Threshold:

- Requests: `5`
- Period: `10 minutes`

Action:

- `Managed Challenge`

Simpan rule.

### Rule 4: Submit quiz

Tujuan:

- mencegah flood submit tanpa terlalu ketat untuk user normal

Isi rule:

- Rule name: `studyforge-submit-quiz`
- Field: `URI Path`
- Operator: `equals`
- Value: `/api/submit-quiz`

Threshold:

- Requests: `20`
- Period: `5 minutes`

Action:

- `Managed Challenge`

Simpan rule.

### Rule 5 opsional: Auth page abuse

Tujuan:

- mitigasi abuse kasar ke halaman masuk/daftar

Catatan:

- ini bukan proteksi auth penuh

Jika ingin menambahkan:

- Rule name: `studyforge-auth-pages`
- URI Path `equals /masuk`
- atau buat rule lain untuk `/daftar`
- threshold ringan, misalnya `20 requests / 5 minutes`
- action `Managed Challenge`

### Setelah semua rule dibuat

Cek:

- status semua rule `Enabled`
- urutan rule tidak bentrok
- action tidak terlalu agresif untuk user normal
- endpoint API yang dipanggil via `fetch()` tetap mengembalikan JSON normal

### Endpoint yang wajib dites setelah WAF aktif

- `/api/ai/explain-question`
- `/api/report-bug`
- `/api/user/init-parse-job`
- `/api/submit-quiz`

## 2. Cache Rules

Dokumentasi acuan:

- https://developers.cloudflare.com/cache/how-to/cache-rules/

### Lokasi menu

1. Cloudflare Dashboard
2. Pilih zone StudyForge
3. Buka `Caching`
4. Buka `Cache Rules`
5. Klik `Create rule`

### Rule 1: Bypass cache untuk API

Tujuan:

- semua API selalu fresh dan tidak pernah ke-cache

Isi rule:

- Rule name: `studyforge-bypass-api`
- Expression:

```text
starts_with(http.request.uri.path, "/api/")
```

Action:

- `Bypass cache`

Simpan rule.

### Rule 2: Bypass cache untuk halaman private dan auth

Tujuan:

- mencegah HTML stale untuk halaman yang sensitif terhadap session/auth

Isi rule:

- Rule name: `studyforge-bypass-private-html`
- Expression:

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

Jika builder dashboard tidak nyaman dengan `in {}`, pecah jadi beberapa condition `equals`.

Action:

- `Bypass cache`

Simpan rule.

### Rule 3: Static assets cache lebih agresif

Tujuan:

- mengurangi request berulang untuk CSS/JS statis

Isi rule:

- Rule name: `studyforge-cache-static-assets`
- Expression:

```text
starts_with(http.request.uri.path, "/css/")
or starts_with(http.request.uri.path, "/js/")
```

Action:

- `Eligible for cache`

Settings tambahan:

- Edge TTL: `1 month`

Jika dashboard meminta Browser TTL terpisah:

- Browser TTL: `Respect existing headers` atau `1 day`

Simpan rule.

### Setelah Cache Rules dibuat

Tes manual:

- buka `/api/quizzes` lalu pastikan response tidak terkena cache HTML rule
- buka `/dashboard`, `/admin`, `/quiz?id=...`, `/result?id=...`
- buka `/css/style.css` dan `/js/...` lalu cek header cache jika perlu

## 3. Web Analytics

Dokumentasi acuan:

- https://developers.cloudflare.com/web-analytics/get-started/
- https://developers.cloudflare.com/pages/how-to/web-analytics/

### Lokasi menu

1. Cloudflare Dashboard
2. Buka `Analytics & Logs`
3. Buka `Web Analytics`
4. Klik `Add a site`

### Setup awal

Isi:

- pilih hostname site StudyForge
- jika ada opsi automatic setup untuk Pages, pilih itu dulu

Jika automatic setup tersedia:

1. aktifkan
2. simpan
3. tunggu propagasi beberapa menit

### Jika automatic setup tidak tersedia

Gunakan snippet manual dari dashboard Cloudflare.

Tahap 1 cukup pasang di route publik:

- `public/index.html`
- opsional `public/login.html`

Belum perlu dipasang ke seluruh app internal.

### Route yang sebaiknya dipantau dulu

- `/`
- `/masuk`
- `/daftar`
- `/paket-soal`
- `/tryout`

Catatan:

- `/paket-soal` dan `/tryout` saat ini masih alias ke `/dashboard`
- jadi dua route ini masih lebih tepat dianggap alias marketing/app sementara, belum katalog publik murni

### Validasi setelah aktif

1. Buka site publik StudyForge
2. Kunjungi:
   - `/`
   - `/masuk`
   - `/daftar`
   - `/paket-soal`
3. Tunggu data masuk ke dashboard analytics

### Catatan jika nanti menambah CSP

Whitelist origin berikut:

- `https://static.cloudflareinsights.com`

## Checklist singkat eksekusi

### WAF

- [ ] Buat rule `/api/ai/explain-question`
- [ ] Buat rule `/api/report-bug`
- [ ] Buat rule `/api/user/init-parse-job`
- [ ] Buat rule `/api/submit-quiz`
- [ ] Opsional rule `/masuk` dan `/daftar`

### Cache

- [ ] Bypass `/api/*`
- [ ] Bypass halaman private/auth
- [ ] Cache lebih agresif untuk `/css/*` dan `/js/*`

### Analytics

- [ ] Aktifkan Web Analytics untuk site
- [ ] Pilih automatic setup jika ada
- [ ] Jika tidak ada, siapkan snippet manual untuk route publik
- [ ] Validasi hit di `/`, `/masuk`, `/daftar`, `/paket-soal`
