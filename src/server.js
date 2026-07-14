// ============================================================
// server.js — Entry Point SucoAir Backend
// Express + WebSocket + SQLite + Fuzzy Mamdani
// ============================================================

require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');

const { setupWebSocket } = require('./websocket');
const { finalizeExpiredInspections } = require('./utils/inspectionAutoClose');

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const companyRoutes = require('./routes/companies');
const inspectionRoutes = require('./routes/inspections');
const sensorRoutes = require('./routes/sensor');
const reportRoutes = require('./routes/reports');
const bakuMutuRoutes = require('./routes/bakuMutu');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 8080;

// ── Middleware CORS ───────────────────────────────────────────
app.use(cors({
  origin: function (origin, callback) {
    // Izinkan akses tanpa origin, misalnya ESP32, Postman, server-to-server
    if (!origin) return callback(null, true);

    // Izinkan localhost untuk development
    if (origin.startsWith('http://localhost')) {
      return callback(null, true);
    }

    // Izinkan Firebase Hosting
    if (origin.includes('web.app') || origin.includes('firebaseapp.com')) {
      return callback(null, true);
    }

    // Izinkan domain custom dari ENV jika ada
    if (process.env.CORS_ORIGIN && origin === process.env.CORS_ORIGIN) {
      return callback(null, true);
    }

    // Selama testing tetap diizinkan
    return callback(null, true);
  },
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Request Logger Development ────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleTimeString('id-ID')}] ${req.method} ${req.path}`);
    next();
  });
}

// ── REST API Routes ───────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/inspections', inspectionRoutes);
app.use('/api/sensor', sensorRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/baku-mutu', bakuMutuRoutes);

// ── Health Check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'SucoAir Backend',
    version: '1.0.0',
    time: new Date().toISOString(),
    ws_clients: app.locals.wsClients?.size ?? 0
  });
});

// ── Auto Close Inspection Scheduler ───────────────────────────
// Mengecek setiap 60 detik apakah ada sesi inspeksi yang durasinya sudah habis.
// Jika durasi habis, status otomatis menjadi "Selesai" dan laporan otomatis dibuat.
setInterval(() => {
  try {
    finalizeExpiredInspections();
  } catch (err) {
    console.error('[AUTO CLOSE ERROR]', err.message);
  }
}, 60000);

// Jalankan sekali saat server baru menyala
try {
  finalizeExpiredInspections();
} catch (err) {
  console.error('[AUTO CLOSE STARTUP ERROR]', err.message);
}

// ── 404 Handler ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.path} tidak ditemukan.`
  });
});

// ── Error Handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);

  res.status(500).json({
    success: false,
    message: 'Terjadi kesalahan server.'
  });
});

// ── WebSocket ─────────────────────────────────────────────────
setupWebSocket(server, app);

// ── Start Server ──────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║       SucoAir Monitor — Backend          ║');
  console.log('║  PT Sucofindo Unit Pelayanan Manado      ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Port Terbuka Publik (Railway): ${PORT}        ║`);
  console.log('║  Health Check: /health                   ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
});

module.exports = { app, server };