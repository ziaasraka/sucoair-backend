// ============================================================
// server.js — Entry Point SucoAir Backend
// Express + WebSocket + SQLite + Fuzzy Mamdani
// ============================================================
require('dotenv').config();

const express   = require('express');
const http      = require('http');
const cors      = require('cors');
const path      = require('path');

const { setupWebSocket } = require('./websocket');

// Routes
const authRoutes        = require('./routes/auth');
const userRoutes        = require('./routes/users');
const companyRoutes     = require('./routes/companies');
const inspectionRoutes  = require('./routes/inspections');
const sensorRoutes      = require('./routes/sensor');
const reportRoutes      = require('./routes/reports');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 8080;

// ── Middleware ────────────────────────────────────────────────
// Mengizinkan domain dinamis dari Firebase Hosting agar tidak terkena CORS Error
app.use(cors({
  origin: function (origin, callback) {
    // Mengizinkan akses tanpa origin (seperti dari ESP32, Postman, atau server-to-server)
    if (!origin) return callback(null, true);
    
    // Mengizinkan localhost (untuk dev) ATAU domain resmi dari Firebase Hosting kamu
    if (origin.startsWith('http://localhost') || origin.includes('web.app') || origin.includes('firebaseapp.com')) {
      return callback(null, true);
    }
    
    // Jika di dashboard Railway kamu mengisi variabel CORS_ORIGIN, domain tersebut juga akan diizinkan
    if (process.env.CORS_ORIGIN && origin === process.env.CORS_ORIGIN) {
      return callback(null, true);
    }

    return callback(null, true); // Setel ke true selama masa testing agar aman
  },
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Request logger (development) ─────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleTimeString('id-ID')}] ${req.method} ${req.path}`);
    next();
  });
}

// ── REST API Routes ───────────────────────────────────────────
app.use('/api/auth',        authRoutes);
app.use('/api/users',       userRoutes);
app.use('/api/companies',   companyRoutes);
app.use('/api/inspections', inspectionRoutes);
app.use('/api/sensor',      sensorRoutes);
app.use('/api/reports',     reportRoutes);

// ── Health Check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:  'ok',
    service: 'SucoAir Backend',
    version: '1.0.0',
    time:    new Date().toISOString(),
    ws_clients: app.locals.wsClients?.size ?? 0,
  });
});

// ── 404 Handler ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.path} tidak ditemukan.` });
});

// ── Error Handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
});

// ── WebSocket ─────────────────────────────────────────────────
setupWebSocket(server, app);

// ── Start Server ──────────────────────────────────────────────
// Menambahkan '0.0.0.0' sangat krusial agar Railway dapat membuka gerbang ke internet luar
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║       SucoAir Monitor — Backend          ║');
  console.log('║  PT Sucofindo Unit Pelayanan Manado       ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Port Terbuka Publik (Railway): ${PORT}        ║`);
  console.log(`║  Health Check: /health                   ║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
});

module.exports = { app, server };
