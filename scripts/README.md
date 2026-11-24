# Kumpulan Script Maintenance & Diagnostik

Folder ini memuat berbagai *script* yang dieksekusi sekali (one-off scripts) untuk keperluan spesifik *maintenance*, perbaikan data, atau verifikasi API. Script ini **bukan** bagian dari sistem web/aplikasi utama.

## Daftar Script

* `fix_quiz_data.mjs`: Script untuk memperbaiki data *quiz* yang *corrupt* atau perlu migrasi struktur JSON.
* `list_models.mjs`: Mengecek daftar model AI (Gemini) yang tersedia dan memastikan koneksi API key bekerja dengan baik.
* `push_admin.js`: Script utilitas untuk memberikan role admin ke akun user secara manual tanpa lewat antarmuka Supabase.
* `migrate_secure_quizzes.mjs`: Melakukan *batch upload/migration* kuis dengan proteksi keamanan dan kebijakan privasi.

### Cara Menjalankan
Pastikan Anda sudah menjalankan `npm install` dan mengatur *environment variables* yang tepat sebelum mengeksekusi script ini dengan Node.js:

```bash
node scripts/nama_script.mjs
```
