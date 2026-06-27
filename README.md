# ⚡ StudyForge

Platform latihan soal interaktif untuk pelajar & mahasiswa Indonesia.

## 🚀 Fitur

- 📤 **Upload PDF** — Admin upload PDF soal, sistem auto-parse jadi quiz interaktif
- ✏️ **Editor Soal** — Edit/koreksi hasil parsing sebelum disimpan
- ⏱️ **Timer Ujian** — Countdown timer saat mengerjakan soal
- 📊 **Review Jawaban** — Review mana yang salah & benar setelah submit
- 📁 **GitHub sebagai DB** — Semua data tersimpan di GitHub repo (gratis!)
- 🏆 **Leaderboard Hasil** — Admin bisa lihat semua hasil ujian peserta

## 📋 Cara Deploy (Vercel)

### 1. Buat GitHub Repo untuk Database
Buat repo baru di GitHub (contoh: `studyforge-db`), set ke **Public**.

### 2. Buat GitHub Personal Access Token
- Pergi ke: GitHub → Settings → Developer Settings → Personal Access Tokens → Tokens (classic)
- Beri centang pada **repo** (full control)
- Copy tokennya

### 3. Deploy ke Vercel
```bash
npm install -g vercel
vercel login
vercel --prod
```

### 4. Konfigurasi di Web
Setelah deploy, buka halaman `/admin` dan isi:
- **GitHub Owner**: username GitHub kamu
- **Repository**: nama repo database (contoh: `studyforge-db`)  
- **Branch**: `main`
- **Token**: Personal Access Token yang tadi dibuat

## 🏗️ Struktur Project

```
studyforge/
├── public/
│   ├── index.html      ← Halaman utama (daftar quiz)
│   ├── admin.html      ← Dashboard admin (upload PDF)
│   ├── quiz.html       ← Halaman kerjakan soal
│   ├── result.html     ← Halaman hasil ujian
│   └── css/
│       └── style.css   ← Styling premium
├── vercel.json
└── package.json
```

## 📂 Struktur GitHub DB

```
studyforge-db/ (repo terpisah)
├── quizzes/
│   ├── index.json          ← Daftar semua quiz
│   ├── quiz-xxx.json       ← Data soal individual
│   └── ...
└── results/
    ├── result-xxx.json     ← Hasil ujian individual
    └── ...
```

## 🛠️ Format Soal yang Didukung

PDF dengan format:
```
1. Pertanyaan di sini
A. Opsi A
B. Opsi B
C. Opsi C
D. Opsi D

Kunci Jawaban:
1. A
2. B
```

## 📄 Lisensi
MIT License — Free to use and modify.
