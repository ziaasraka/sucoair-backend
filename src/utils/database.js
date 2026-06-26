// ============================================================
// database.js — Inisialisasi SQLite dengan better-sqlite3
// ============================================================
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const bcrypt   = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || './data/sucoair.db';

// Pastikan folder data ada
const dbDir = path.dirname(path.resolve(DB_PATH));
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.resolve(DB_PATH));

// Aktifkan WAL mode untuk performa lebih baik
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Buat Tabel ───────────────────────────────────────────────
db.exec(`
  -- Pengguna sistem
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    name       TEXT NOT NULL,
    role       TEXT NOT NULL CHECK(role IN ('admin','user')),
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- Perusahaan yang diinspeksi
  CREATE TABLE IF NOT EXISTS companies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    address    TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- Sesi inspeksi
  CREATE TABLE IF NOT EXISTS inspections (
    id          TEXT PRIMARY KEY,
    company_id  INTEGER NOT NULL REFERENCES companies(id),
    location    TEXT NOT NULL,
    status      TEXT DEFAULT 'Berlangsung' CHECK(status IN ('Berlangsung','Selesai')),
    started_at  TEXT DEFAULT (datetime('now','localtime')),
    ended_at    TEXT,
    duration    TEXT DEFAULT '1 hari',
    notes       TEXT,
    created_by  INTEGER REFERENCES users(id)
  );

  -- Data sensor real-time dari ESP32
  CREATE TABLE IF NOT EXISTS sensor_data (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    inspection_id TEXT REFERENCES inspections(id),
    recorded_at   TEXT DEFAULT (datetime('now','localtime')),
    pm25          REAL,
    pm10          REAL,
    co            REAL,
    no2           REAL,
    so2           REAL,
    o3            REAL,
    temperature   REAL,
    humidity      REAL,
    pressure      REAL,
    ispu          INTEGER,
    kategori      TEXT,
    membership    TEXT
  );

  -- Laporan inspeksi
  CREATE TABLE IF NOT EXISTS reports (
    id            TEXT PRIMARY KEY,
    company_id    INTEGER REFERENCES companies(id),
    inspection_id TEXT REFERENCES inspections(id),
    title         TEXT NOT NULL,
    period        TEXT,
    format        TEXT DEFAULT 'Excel',
    notes         TEXT,
    created_at    TEXT DEFAULT (datetime('now','localtime')),
    created_by    INTEGER REFERENCES users(id)
  );
`);

// ── Seed Data Awal ───────────────────────────────────────────
function seedInitialData() {
  // Admin default (hanya jika belum ada)
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!existing) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`
      INSERT INTO users (username, password, name, role) VALUES
      ('admin',  ?, 'Sitti Nurhazriah Asraka', 'admin'),
      ('agil',   ?, 'Mohamad Agil Saputra K.', 'user'),
      ('suci',   ?, 'Suci Fitriani Siden',      'user')
    `).run(hash, bcrypt.hashSync('user123', 10), bcrypt.hashSync('user123', 10));

    // Perusahaan contoh
    db.prepare(`
      INSERT INTO companies (name, address) VALUES
      ('PT Semen Tonasa Manado',     'Jl. Industri No.12, Manado'),
      ('PT PLN (Persero) UP Manado', 'Jl. Ahmad Yani No.5, Manado'),
      ('CV Beton Sulawesi',          'Jl. Piere Tendean No.8, Bitung')
    `).run();

    console.log('[DB] Seed data berhasil dibuat.');
    console.log('[DB] Admin: admin / admin123');
    console.log('[DB] User:  agil  / user123');
  }
}

seedInitialData();

module.exports = db;
