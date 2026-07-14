// ============================================================
// server.js — Entry Point SucoAir Backend
// Express + WebSocket + SQLite + Evaluasi Baku Mutu
// ============================================================

require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');

const { setupWebSocket } = require('./websocket');

const {
  finalizeExpiredInspections
} = require('./utils/inspectionAutoClose');


// ============================================================
// ROUTES
// ============================================================

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const companyRoutes = require('./routes/companies');
const inspectionRoutes = require('./routes/inspections');
const sensorRoutes = require('./routes/sensor');
const reportRoutes = require('./routes/reports');

// Nama file:
// src/routes/bakumutu.js
const bakuMutuRoutes = require('./routes/bakumutu');


const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 8080;


// ============================================================
// MIDDLEWARE CORS
// ============================================================

app.use(
  cors({
    origin(origin, callback) {
      // ESP32, Postman, server-to-server biasanya tidak mengirim origin.
      if (!origin) {
        return callback(null, true);
      }

      // Development localhost.
      if (
        origin.startsWith('http://localhost') ||
        origin.startsWith('http://127.0.0.1')
      ) {
        return callback(null, true);
      }

      // Firebase Hosting.
      if (
        origin.endsWith('.web.app') ||
        origin.endsWith('.firebaseapp.com')
      ) {
        return callback(null, true);
      }

      // Domain tambahan dari environment variable.
      if (
        process.env.CORS_ORIGIN &&
        origin === process.env.CORS_ORIGIN
      ) {
        return callback(null, true);
      }

      // Sementara tetap diizinkan selama pengembangan.
      return callback(null, true);
    },

    credentials: true,

    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS'
    ],

    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Device-Key',
      'Cache-Control',
      'Pragma'
    ]
  })
);


// ============================================================
// BODY PARSER
// ============================================================

app.use(express.json());
app.use(
  express.urlencoded({
    extended: true
  })
);


// ============================================================
// REQUEST LOGGER DEVELOPMENT
// ============================================================

if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(
      `[${new Date().toLocaleTimeString('id-ID')}] ` +
      `${req.method} ${req.path}`
    );

    next();
  });
}


// ============================================================
// REST API ROUTES
// ============================================================

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/inspections', inspectionRoutes);
app.use('/api/sensor', sensorRoutes);
app.use('/api/reports', reportRoutes);

// Evaluasi baku mutu per parameter.
app.use('/api/baku-mutu', bakuMutuRoutes);


// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/health', (req, res) => {
  return res.json({
    status: 'ok',
    service: 'SucoAir Backend',
    version: '1.0.0',
    time: new Date().toISOString(),
    ws_clients:
      app.locals.wsClients?.size ?? 0
  });
});


// ============================================================
// AUTO CLOSE INSPECTION SCHEDULER
//
// Mengecek setiap 60 detik apakah ada sesi inspeksi yang
// durasinya telah selesai.
// ============================================================

setInterval(() => {
  try {
    finalizeExpiredInspections();
  } catch (error) {
    console.error(
      '[AUTO CLOSE ERROR]',
      error.message
    );
  }
}, 60 * 1000);


// Jalankan sekali saat server mulai.
try {
  finalizeExpiredInspections();
} catch (error) {
  console.error(
    '[AUTO CLOSE STARTUP ERROR]',
    error.message
  );
}


// ============================================================
// 404 HANDLER
// ============================================================

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message:
      `Route ${req.path} tidak ditemukan.`
  });
});


// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

app.use((error, req, res, next) => {
  console.error(
    '[SERVER ERROR]',
    error
  );

  return res.status(500).json({
    success: false,
    message: 'Terjadi kesalahan server.',
    error:
      process.env.NODE_ENV !== 'production'
        ? error.message
        : undefined
  });
});


// ============================================================
// WEBSOCKET
// ============================================================

setupWebSocket(server, app);


// ============================================================
// START SERVER
// ============================================================

server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log('');
    console.log(
      '╔══════════════════════════════════════════╗'
    );
    console.log(
      '║       SucoAir Monitor — Backend          ║'
    );
    console.log(
      '║  PT Sucofindo Unit Pelayanan Manado      ║'
    );
    console.log(
      '╠══════════════════════════════════════════╣'
    );
    console.log(
      `║  Port Terbuka Publik (Railway): ${PORT}`
    );
    console.log(
      '║  Health Check: /health                   ║'
    );
    console.log(
      '║  Baku Mutu: /api/baku-mutu              ║'
    );
    console.log(
      '╚══════════════════════════════════════════╝'
    );
    console.log('');
  }
);


module.exports = {
  app,
  server
};