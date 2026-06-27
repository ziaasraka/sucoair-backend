// ============================================================
// routes/sensor.js — Endpoint Penerima Data dari ESP32
//
// ESP32 kirim data ke:
//   POST /api/sensor/data
//   Header: X-Device-Key: <ESP32_DEVICE_KEY>
//   Body JSON: {
//     pm25,
//     pm10,
//     co,
//     no2,
//     so2,
//     o3,
//     temperature,
//     humidity,
//     pressure
//   }
//
// Alur penyimpanan:
// - Jika ada 1 sesi inspeksi Berlangsung:
//   data disimpan dengan inspection_id sesi aktif.
// - Jika tidak ada sesi inspeksi Berlangsung:
//   data tetap disimpan sebagai monitoring umum dengan inspection_id = null.
// - Jika ada lebih dari 1 sesi inspeksi Berlangsung:
//   data ditolak agar tidak salah masuk perusahaan.
//
// GET /api/sensor/latest   — data terbaru untuk dashboard
// GET /api/sensor/history  — riwayat data sensor
// GET /api/sensor/stats    — statistik ringkasan
// ============================================================

const express = require('express');
const db = require('../utils/database');
const { hitungISPU } = require('../utils/fuzzyMamdani');
const { requireAuth } = require('../middleware/auth');

const {
  finalizeExpiredInspections
} = require('../utils/inspectionAutoClose');

const {
  cleanupOldMonitoringData
} = require('../utils/sensorCleanup');

const router = express.Router();

// ============================================================
// Middleware: validasi Device Key untuk ESP32
// ============================================================
function requireDeviceKey(req, res, next) {
  const key = req.headers['x-device-key'];

  if (key !== (process.env.ESP32_DEVICE_KEY || 'ESP32_SUCOFINDO_MANADO_2025')) {
    return res.status(401).json({
      success: false,
      message: 'Device key tidak valid.'
    });
  }

  next();
}

// ============================================================
// POST /api/sensor/data — menerima data dari ESP32
// ============================================================
router.post('/data', requireDeviceKey, (req, res) => {
  try {
    const {
      pm25,
      pm10,
      co,
      no2,
      so2,
      o3,
      temperature,
      humidity,
      pressure
    } = req.body;

    // Tutup otomatis sesi inspeksi yang durasinya sudah habis
    finalizeExpiredInspections();

    // Hapus data monitoring umum yang lebih dari 1 hari
    // Hanya menghapus data dengan inspection_id null / kosong
    cleanupOldMonitoringData();

    // Ambil semua sesi inspeksi yang sedang berlangsung
    const activeRows = db.prepare(`
      SELECT
        id,
        company_id,
        location,
        status,
        started_at,
        duration
      FROM inspections
      WHERE status = 'Berlangsung'
      ORDER BY started_at DESC
    `).all();

    let activeInspection = null;
    let targetInspectionId = null;
    let targetCompanyId = null;
    let saveMode = 'monitoring';

    // Kalau ada lebih dari satu sesi aktif, data ditolak
    // Karena satu ESP32 tidak boleh masuk ke banyak sesi sekaligus
    if (activeRows.length > 1) {
      return res.status(409).json({
        success: false,
        message: 'Ada lebih dari satu sesi inspeksi yang sedang berlangsung. Selesaikan atau hapus sesi lain dulu agar data ESP32 tidak salah masuk.',
        active_sessions: activeRows
      });
    }

    // Kalau ada tepat satu sesi aktif, data masuk ke sesi itu
    if (activeRows.length === 1) {
      activeInspection = activeRows[0];
      targetInspectionId = activeInspection.id;
      targetCompanyId = activeInspection.company_id;
      saveMode = 'inspection';
    }

    // Kalau tidak ada sesi aktif:
    // targetInspectionId tetap null
    // targetCompanyId tetap null
    // saveMode tetap monitoring
    // Data tetap disimpan untuk dashboard umum

    // Validasi nilai polutan utama
    const vals = [pm25, pm10, co, no2, so2, o3];

    if (vals.some((v) => v === undefined || v === null || isNaN(v))) {
      return res.status(400).json({
        success: false,
        message: 'Data sensor tidak lengkap atau tidak valid.'
      });
    }

    const nPm25 = parseFloat(pm25);
    const nPm10 = parseFloat(pm10);
    const nCo = parseFloat(co);
    const nNo2 = parseFloat(no2);
    const nSo2 = parseFloat(so2);
    const nO3 = parseFloat(o3);

    const nTemperature =
      temperature === undefined || temperature === null || isNaN(temperature)
        ? null
        : parseFloat(temperature);

    const nHumidity =
      humidity === undefined || humidity === null || isNaN(humidity)
        ? null
        : parseFloat(humidity);

    const nPressure =
      pressure === undefined || pressure === null || isNaN(pressure)
        ? null
        : parseFloat(pressure);

    // Hitung ISPU dengan Fuzzy Mamdani
    const fuzzy = hitungISPU(
      nPm25,
      nPm10,
      nCo,
      nNo2,
      nSo2,
      nO3
    );

    // Simpan data ke database
    // Jika tidak ada sesi aktif, targetInspectionId = null
    const result = db.prepare(`
      INSERT INTO sensor_data
        (
          inspection_id,
          pm25,
          pm10,
          co,
          no2,
          so2,
          o3,
          temperature,
          humidity,
          pressure,
          ispu,
          kategori,
          membership
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      targetInspectionId,
      nPm25,
      nPm10,
      nCo,
      nNo2,
      nSo2,
      nO3,
      nTemperature,
      nHumidity,
      nPressure,
      fuzzy.ispu,
      fuzzy.kategori,
      JSON.stringify(fuzzy.membership)
    );

    const insertedData = {
      id: result.lastInsertRowid,
      mode: saveMode,
      company_id: targetCompanyId,
      inspection_id: targetInspectionId,
      recorded_at: new Date().toISOString(),
      pm25: nPm25,
      pm10: nPm10,
      co: nCo,
      no2: nNo2,
      so2: nSo2,
      o3: nO3,
      temperature: nTemperature,
      humidity: nHumidity,
      pressure: nPressure,
      ispu: fuzzy.ispu,
      kategori: fuzzy.kategori,
      membership: fuzzy.membership
    };

    // Broadcast realtime ke client WebSocket
    const payload = JSON.stringify({
      type: 'sensor_update',
      data: insertedData
    });

    if (req.app.locals.wsBroadcast) {
      req.app.locals.wsBroadcast(payload);
    }

    res.json({
      success: true,
      mode: saveMode,
      company_id: targetCompanyId,
      inspection_id: targetInspectionId,
      ispu: fuzzy.ispu,
      kategori: fuzzy.kategori,
      message:
        saveMode === 'inspection'
          ? 'Data berhasil disimpan ke sesi inspeksi aktif.'
          : 'Data berhasil disimpan sebagai monitoring umum tanpa sesi inspeksi.',
      data: insertedData
    });
  } catch (err) {
    console.error('[POST SENSOR DATA ERROR]', err.message);

    res.status(500).json({
      success: false,
      message: 'Gagal menyimpan data sensor.',
      error: err.message
    });
  }
});

// ============================================================
// GET /api/sensor/latest — data terbaru untuk dashboard
// ============================================================
router.get('/latest', requireAuth, (req, res) => {
  try {
    finalizeExpiredInspections();
    cleanupOldMonitoringData();

    const row = db.prepare(`
      SELECT *
      FROM sensor_data
      ORDER BY recorded_at DESC
      LIMIT 1
    `).get();

    if (!row) {
      return res.status(404).json({
        success: false,
        message: 'Belum ada data.'
      });
    }

    if (row.membership) {
      row.membership = JSON.parse(row.membership);
    }

    res.json({
      success: true,
      data: row
    });
  } catch (err) {
    console.error('[GET SENSOR LATEST ERROR]', err.message);

    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data sensor terbaru.',
      error: err.message
    });
  }
});

// ============================================================
// GET /api/sensor/history — riwayat data sensor
//
// Query optional:
// ?inspection_id=INS-xxxx
// ?limit=288
// ?offset=0
// ?monitoring_only=true
// ============================================================
router.get('/history', requireAuth, (req, res) => {
  try {
    finalizeExpiredInspections();
    cleanupOldMonitoringData();

    const {
      inspection_id,
      monitoring_only,
      limit = 288,
      offset = 0
    } = req.query;

    let sql = `
      SELECT *
      FROM sensor_data
      WHERE 1=1
    `;

    const params = [];

    if (inspection_id) {
      sql += ' AND inspection_id = ?';
      params.push(inspection_id);
    }

    if (monitoring_only === 'true') {
      sql += ` AND (inspection_id IS NULL OR inspection_id = '')`;
    }

    sql += ' ORDER BY recorded_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const rows = db.prepare(sql).all(...params).map((row) => ({
      ...row,
      membership: row.membership ? JSON.parse(row.membership) : null
    }));

    res.json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (err) {
    console.error('[GET SENSOR HISTORY ERROR]', err.message);

    res.status(500).json({
      success: false,
      message: 'Gagal mengambil riwayat data sensor.',
      error: err.message
    });
  }
});

// ============================================================
// GET /api/sensor/stats — statistik ringkasan sensor
//
// Query optional:
// ?inspection_id=INS-xxxx
// ?monitoring_only=true
// ============================================================
router.get('/stats', requireAuth, (req, res) => {
  try {
    finalizeExpiredInspections();
    cleanupOldMonitoringData();

    const {
      inspection_id,
      monitoring_only
    } = req.query;

    let where = 'WHERE 1=1';
    const params = [];

    if (inspection_id) {
      where += ' AND inspection_id = ?';
      params.push(inspection_id);
    }

    if (monitoring_only === 'true') {
      where += ` AND (inspection_id IS NULL OR inspection_id = '')`;
    }

    const stats = db.prepare(`
      SELECT
        COUNT(*) AS total,
        ROUND(AVG(pm25), 2) AS avg_pm25,
        ROUND(MAX(pm25), 2) AS max_pm25,
        ROUND(AVG(pm10), 2) AS avg_pm10,
        ROUND(MAX(pm10), 2) AS max_pm10,
        ROUND(AVG(co), 3) AS avg_co,
        ROUND(AVG(no2), 1) AS avg_no2,
        ROUND(AVG(so2), 1) AS avg_so2,
        ROUND(AVG(o3), 1) AS avg_o3,
        ROUND(AVG(temperature), 2) AS avg_temperature,
        ROUND(AVG(humidity), 2) AS avg_humidity,
        ROUND(AVG(pressure), 2) AS avg_pressure,
        ROUND(AVG(ispu), 0) AS avg_ispu,
        MAX(ispu) AS max_ispu,
        MIN(ispu) AS min_ispu
      FROM sensor_data
      ${where}
    `).get(...params);

    res.json({
      success: true,
      data: stats
    });
  } catch (err) {
    console.error('[GET SENSOR STATS ERROR]', err.message);

    res.status(500).json({
      success: false,
      message: 'Gagal mengambil statistik sensor.',
      error: err.message
    });
  }
});

module.exports = router;