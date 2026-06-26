// ============================================================
// routes/sensor.js — Endpoint Penerima Data dari ESP32
//
// ESP32 kirim data ke:
//   POST /api/sensor/data
//   Header: X-Device-Key: <ESP32_DEVICE_KEY>
//   Body JSON: { inspection_id, pm25, pm10, co, no2, so2, o3, temp, humidity, pressure }
//
// GET /api/sensor/latest   — data terbaru (untuk polling frontend)
// GET /api/sensor/history  — riwayat (query: limit, inspection_id)
// ============================================================
const express = require('express');
const db      = require('../utils/database');
const { hitungISPU } = require('../utils/fuzzyMamdani');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── Middleware: Device Key untuk ESP32 ───────────────────────
function requireDeviceKey(req, res, next) {
  const key = req.headers['x-device-key'];
  if (key !== (process.env.ESP32_DEVICE_KEY || 'ESP32_SUCOFINDO_MANADO_2025')) {
    return res.status(401).json({ success: false, message: 'Device key tidak valid.' });
  }
  next();
}

// ── POST /api/sensor/data — Terima data dari ESP32 ───────────
router.post('/data', requireDeviceKey, (req, res) => {
  const {
    inspection_id,
    pm25, pm10, co, no2, so2, o3,
    temperature, humidity, pressure,
  } = req.body;

  // Validasi nilai numerik
  const vals = [pm25, pm10, co, no2, so2, o3];
  if (vals.some(v => v === undefined || v === null || isNaN(v))) {
    return res.status(400).json({ success: false, message: 'Data sensor tidak lengkap atau tidak valid.' });
  }

  // Hitung ISPU dengan Fuzzy Mamdani
  const fuzzy = hitungISPU(
    parseFloat(pm25), parseFloat(pm10), parseFloat(co),
    parseFloat(no2),  parseFloat(so2),  parseFloat(o3)
  );

  // Simpan ke database
  const result = db.prepare(`
    INSERT INTO sensor_data
      (inspection_id, pm25, pm10, co, no2, so2, o3,
       temperature, humidity, pressure, ispu, kategori, membership)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    inspection_id || null,
    pm25, pm10, co, no2, so2, o3,
    temperature || null, humidity || null, pressure || null,
    fuzzy.ispu, fuzzy.kategori,
    JSON.stringify(fuzzy.membership)
  );

  // Broadcast ke semua client WebSocket yang terkoneksi
  const payload = JSON.stringify({
    type: 'sensor_update',
    data: {
      id:           result.lastInsertRowid,
      inspection_id,
      recorded_at:  new Date().toISOString(),
      pm25, pm10, co, no2, so2, o3,
      temperature, humidity, pressure,
      ispu:         fuzzy.ispu,
      kategori:     fuzzy.kategori,
      membership:   fuzzy.membership,
    },
  });

  // wsBroadcast di-inject dari server.js
  if (req.app.locals.wsBroadcast) {
    req.app.locals.wsBroadcast(payload);
  }

  res.json({
    success:  true,
    ispu:     fuzzy.ispu,
    kategori: fuzzy.kategori,
    message:  'Data berhasil disimpan.',
  });
});

// ── GET /api/sensor/latest — data terbaru (untuk frontend polling) ──
router.get('/latest', requireAuth, (req, res) => {
  const row = db.prepare(
    'SELECT * FROM sensor_data ORDER BY recorded_at DESC LIMIT 1'
  ).get();

  if (!row) return res.status(404).json({ success: false, message: 'Belum ada data.' });
  if (row.membership) row.membership = JSON.parse(row.membership);
  res.json({ success: true, data: row });
});

// ── GET /api/sensor/history — riwayat data ───────────────────
router.get('/history', requireAuth, (req, res) => {
  const { inspection_id, limit = 288, offset = 0 } = req.query;
  let sql = 'SELECT * FROM sensor_data WHERE 1=1';
  const params = [];

  if (inspection_id) { sql += ' AND inspection_id = ?'; params.push(inspection_id); }
  sql += ' ORDER BY recorded_at DESC LIMIT ? OFFSET ?';
  params.push(+limit, +offset);

  const rows = db.prepare(sql).all(...params).map(r => ({
    ...r,
    membership: r.membership ? JSON.parse(r.membership) : null,
  }));

  res.json({ success: true, count: rows.length, data: rows });
});

// ── GET /api/sensor/stats — statistik ringkasan ──────────────
router.get('/stats', requireAuth, (req, res) => {
  const { inspection_id } = req.query;
  let where = inspection_id ? 'WHERE inspection_id = ?' : '';
  const params = inspection_id ? [inspection_id] : [];

  const stats = db.prepare(`
    SELECT
      COUNT(*)   AS total,
      ROUND(AVG(pm25),2)  AS avg_pm25,
      ROUND(MAX(pm25),2)  AS max_pm25,
      ROUND(AVG(pm10),2)  AS avg_pm10,
      ROUND(MAX(pm10),2)  AS max_pm10,
      ROUND(AVG(co),3)    AS avg_co,
      ROUND(AVG(no2),1)   AS avg_no2,
      ROUND(AVG(so2),1)   AS avg_so2,
      ROUND(AVG(o3),1)    AS avg_o3,
      ROUND(AVG(ispu),0)  AS avg_ispu,
      MAX(ispu)           AS max_ispu,
      MIN(ispu)           AS min_ispu
    FROM sensor_data ${where}
  `).get(...params);

  res.json({ success: true, data: stats });
});

module.exports = router;
