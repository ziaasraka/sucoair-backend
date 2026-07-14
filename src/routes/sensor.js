// ============================================================
// routes/sensor.js — Endpoint Penerima Data dari ESP32
//
// ESP32 mengirim data ke:
//   POST /api/sensor/data
//
// Header:
//   X-Device-Key: <ESP32_DEVICE_KEY>
//
// Body JSON:
// {
//   pm25,
//   pm10,
//   co,
//   no2,
//   so2,
//   o3,
//   temperature,
//   humidity,
//   pressure
// }
//
// Alur penyimpanan:
// - Jika ada tepat 1 sesi inspeksi Berlangsung:
//   data disimpan dengan inspection_id sesi aktif.
//
// - Jika tidak ada sesi inspeksi Berlangsung:
//   data tetap disimpan sebagai monitoring umum
//   dengan inspection_id = null.
//
// - Jika ada lebih dari 1 sesi inspeksi Berlangsung:
//   data ditolak agar tidak salah masuk perusahaan.
//
// Catatan:
// - Endpoint ini tidak lagi menghitung ISPU.
// - Endpoint ini hanya menyimpan data mentah sensor.
// - Evaluasi baku mutu dilakukan melalui:
//   GET /api/baku-mutu/inspection/:inspectionId
//
// Endpoint:
// GET /api/sensor/latest
// GET /api/sensor/history
// GET /api/sensor/stats
// ============================================================

const express = require('express');
const db = require('../utils/database');
const { requireAuth } = require('../middleware/auth');

const {
  finalizeExpiredInspections
} = require('../utils/inspectionAutoClose');

const {
  cleanupOldMonitoringData
} = require('../utils/sensorCleanup');

const router = express.Router();


// ============================================================
// Helper parsing membership lama
//
// Data baru tidak lagi menggunakan membership fuzzy.
// Namun data lama mungkin masih memiliki membership berbentuk
// JSON string, sehingga tetap diparsing untuk kompatibilitas.
// ============================================================

function parseMembership(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn(
      '[MEMBERSHIP PARSE WARNING]',
      'Data membership lama tidak valid:',
      error.message
    );

    return null;
  }
}


// ============================================================
// Middleware validasi Device Key untuk ESP32
// ============================================================

function requireDeviceKey(req, res, next) {
  const key = req.headers['x-device-key'];

  const validKey =
    process.env.ESP32_DEVICE_KEY ||
    'ESP32_SUCOFINDO_MANADO_2025';

  if (key !== validKey) {
    return res.status(401).json({
      success: false,
      message: 'Device key tidak valid.'
    });
  }

  next();
}


// ============================================================
// POST /api/sensor/data
//
// Menerima dan menyimpan data mentah dari ESP32.
//
// Tidak ada lagi:
// - perhitungan fuzzy Mamdani;
// - perhitungan ISPU;
// - kategori ISPU;
// - membership fuzzy.
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

    // Hapus data monitoring umum yang lebih dari 1 hari.
    // Hanya data dengan inspection_id null atau kosong.
    cleanupOldMonitoringData();


    // ========================================================
    // Cari sesi inspeksi yang sedang berlangsung
    // ========================================================

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


    // ========================================================
    // Jangan izinkan lebih dari satu sesi aktif
    // ========================================================

    if (activeRows.length > 1) {
      return res.status(409).json({
        success: false,

        message:
          'Ada lebih dari satu sesi inspeksi yang sedang berlangsung. ' +
          'Selesaikan atau hapus sesi lain terlebih dahulu agar data ' +
          'ESP32 tidak salah masuk.',

        active_sessions: activeRows
      });
    }


    // ========================================================
    // Jika ada satu sesi aktif, data dimasukkan ke sesi tersebut
    // ========================================================

    if (activeRows.length === 1) {
      activeInspection = activeRows[0];

      targetInspectionId = activeInspection.id;
      targetCompanyId = activeInspection.company_id;
      saveMode = 'inspection';
    }


    // ========================================================
    // Validasi parameter polutan utama
    // ========================================================

    const pollutantValues = [
      pm25,
      pm10,
      co,
      no2,
      so2,
      o3
    ];

    const invalidPollutant = pollutantValues.some((value) => {
      return (
        value === undefined ||
        value === null ||
        value === '' ||
        !Number.isFinite(Number(value))
      );
    });

    if (invalidPollutant) {
      return res.status(400).json({
        success: false,
        message:
          'Data sensor tidak lengkap atau terdapat nilai polutan yang tidak valid.'
      });
    }


    // ========================================================
    // Konversi data utama menjadi angka
    // ========================================================

    const nPm25 = Number(pm25);
    const nPm10 = Number(pm10);
    const nCo = Number(co);
    const nNo2 = Number(no2);
    const nSo2 = Number(so2);
    const nO3 = Number(o3);


    // ========================================================
    // Helper untuk parameter tambahan opsional
    // ========================================================

    function parseOptionalNumber(value) {
      if (
        value === undefined ||
        value === null ||
        value === ''
      ) {
        return null;
      }

      const number = Number(value);

      if (!Number.isFinite(number)) {
        return null;
      }

      return number;
    }

    const nTemperature = parseOptionalNumber(temperature);
    const nHumidity = parseOptionalNumber(humidity);
    const nPressure = parseOptionalNumber(pressure);


    // ========================================================
    // Validasi nilai negatif
    //
    // Konsentrasi sensor tidak boleh negatif.
    // ========================================================

    const negativePollutant = [
      nPm25,
      nPm10,
      nCo,
      nNo2,
      nSo2,
      nO3
    ].some((value) => value < 0);

    if (negativePollutant) {
      return res.status(400).json({
        success: false,
        message:
          'Nilai konsentrasi polutan tidak boleh bernilai negatif.'
      });
    }


    // ========================================================
    // Simpan data mentah ke database
    //
    // Kolom ispu, kategori, dan membership tetap dipertahankan
    // untuk kompatibilitas database lama, tetapi diisi NULL.
    // ========================================================

    const result = db.prepare(`
      INSERT INTO sensor_data (
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
      null,
      null,
      null
    );


    // ========================================================
    // Data yang dikirim ke WebSocket dan response
    // ========================================================

    const insertedData = {
      id: Number(result.lastInsertRowid),

      inspection_id: targetInspectionId,

      pm25: nPm25,
      pm10: nPm10,
      co: nCo,
      no2: nNo2,
      so2: nSo2,
      o3: nO3,

      temperature: nTemperature,
      humidity: nHumidity,
      pressure: nPressure,

      // Sistem baru tidak lagi menggunakan ISPU.
      // Tetap dikirim sebagai null agar frontend lama tidak error.
      ispu: null,
      kategori: null,
      membership: null
    };


    // ========================================================
    // Broadcast realtime melalui WebSocket
    // ========================================================

    const payload = JSON.stringify({
      type: 'sensor_update',
      data: insertedData
    });

    if (
      req.app.locals.wsBroadcast &&
      typeof req.app.locals.wsBroadcast === 'function'
    ) {
      req.app.locals.wsBroadcast(payload);
    }


    // ========================================================
    // Response berhasil
    // ========================================================

    return res.status(201).json({
      success: true,

      mode: saveMode,

      company_id: targetCompanyId,
      inspection_id: targetInspectionId,

      // Dipertahankan sementara untuk kompatibilitas frontend lama.
      ispu: null,
      kategori: null,

      message:
        saveMode === 'inspection'
          ? 'Data berhasil disimpan ke sesi inspeksi aktif.'
          : 'Data berhasil disimpan sebagai monitoring umum tanpa sesi inspeksi.',

      data: insertedData
    });
  } catch (error) {
    console.error(
      '[POST SENSOR DATA ERROR]',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Gagal menyimpan data sensor.',
      error: error.message
    });
  }
});


// ============================================================
// GET /api/sensor/latest
//
// Mengambil data sensor terbaru untuk dashboard.
// ============================================================

router.get('/latest', requireAuth, (req, res) => {
  try {
    finalizeExpiredInspections();
    cleanupOldMonitoringData();

    const row = db.prepare(`
      SELECT *
      FROM sensor_data
      ORDER BY recorded_at DESC, id DESC
      LIMIT 1
    `).get();

    if (!row) {
      return res.status(404).json({
        success: false,
        message: 'Belum ada data sensor.'
      });
    }

    // Membership hanya digunakan untuk membaca data lama.
    row.membership = parseMembership(row.membership);

    return res.json({
      success: true,
      data: row
    });
  } catch (error) {
    console.error(
      '[GET SENSOR LATEST ERROR]',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil data sensor terbaru.',
      error: error.message
    });
  }
});


// ============================================================
// GET /api/sensor/history
//
// Riwayat data sensor.
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


    // ========================================================
    // Validasi limit dan offset
    // ========================================================

    let numericLimit = Number(limit);
    let numericOffset = Number(offset);

    if (
      !Number.isInteger(numericLimit) ||
      numericLimit < 1
    ) {
      numericLimit = 288;
    }

    if (numericLimit > 5000) {
      numericLimit = 5000;
    }

    if (
      !Number.isInteger(numericOffset) ||
      numericOffset < 0
    ) {
      numericOffset = 0;
    }


    // ========================================================
    // Susun query
    // ========================================================

    let sql = `
      SELECT *
      FROM sensor_data
      WHERE 1 = 1
    `;

    const params = [];

    if (inspection_id) {
      sql += ' AND inspection_id = ?';
      params.push(inspection_id);
    }

    if (monitoring_only === 'true') {
      sql += `
        AND (
          inspection_id IS NULL
          OR inspection_id = ''
        )
      `;
    }

    sql += `
      ORDER BY recorded_at DESC, id DESC
      LIMIT ?
      OFFSET ?
    `;

    params.push(
      numericLimit,
      numericOffset
    );


    // ========================================================
    // Jalankan query
    // ========================================================

    const rows = db
      .prepare(sql)
      .all(...params)
      .map((row) => ({
        ...row,

        // Membership hanya untuk kompatibilitas data lama.
        membership: parseMembership(row.membership)
      }));


    return res.json({
      success: true,
      count: rows.length,
      limit: numericLimit,
      offset: numericOffset,
      data: rows
    });
  } catch (error) {
    console.error(
      '[GET SENSOR HISTORY ERROR]',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil riwayat data sensor.',
      error: error.message
    });
  }
});


// ============================================================
// GET /api/sensor/stats
//
// Statistik deskriptif data sensor.
//
// Query optional:
// ?inspection_id=INS-xxxx
// ?monitoring_only=true
//
// Catatan:
// Statistik ini bukan evaluasi baku mutu.
// Evaluasi baku mutu dilakukan melalui route /api/baku-mutu.
// ============================================================

router.get('/stats', requireAuth, (req, res) => {
  try {
    finalizeExpiredInspections();
    cleanupOldMonitoringData();

    const {
      inspection_id,
      monitoring_only
    } = req.query;

    let where = 'WHERE 1 = 1';
    const params = [];


    // ========================================================
    // Filter berdasarkan inspeksi
    // ========================================================

    if (inspection_id) {
      where += ' AND inspection_id = ?';
      params.push(inspection_id);
    }


    // ========================================================
    // Filter monitoring umum
    // ========================================================

    if (monitoring_only === 'true') {
      where += `
        AND (
          inspection_id IS NULL
          OR inspection_id = ''
        )
      `;
    }


    // ========================================================
    // Statistik data sensor
    //
    // ISPU tidak lagi dihitung.
    // avg_ispu, max_ispu, min_ispu dikembalikan sebagai null
    // sementara agar frontend lama tetap kompatibel.
    // ========================================================

    const stats = db.prepare(`
      SELECT
        COUNT(*) AS total,

        ROUND(AVG(pm25), 2) AS avg_pm25,
        ROUND(MAX(pm25), 2) AS max_pm25,
        ROUND(MIN(pm25), 2) AS min_pm25,

        ROUND(AVG(pm10), 2) AS avg_pm10,
        ROUND(MAX(pm10), 2) AS max_pm10,
        ROUND(MIN(pm10), 2) AS min_pm10,

        ROUND(AVG(co), 3) AS avg_co,
        ROUND(MAX(co), 3) AS max_co,
        ROUND(MIN(co), 3) AS min_co,

        ROUND(AVG(no2), 2) AS avg_no2,
        ROUND(MAX(no2), 2) AS max_no2,
        ROUND(MIN(no2), 2) AS min_no2,

        ROUND(AVG(so2), 2) AS avg_so2,
        ROUND(MAX(so2), 2) AS max_so2,
        ROUND(MIN(so2), 2) AS min_so2,

        ROUND(AVG(o3), 2) AS avg_o3,
        ROUND(MAX(o3), 2) AS max_o3,
        ROUND(MIN(o3), 2) AS min_o3,

        ROUND(AVG(temperature), 2) AS avg_temperature,
        ROUND(MAX(temperature), 2) AS max_temperature,
        ROUND(MIN(temperature), 2) AS min_temperature,

        ROUND(AVG(humidity), 2) AS avg_humidity,
        ROUND(MAX(humidity), 2) AS max_humidity,
        ROUND(MIN(humidity), 2) AS min_humidity,

        ROUND(AVG(pressure), 2) AS avg_pressure,
        ROUND(MAX(pressure), 2) AS max_pressure,
        ROUND(MIN(pressure), 2) AS min_pressure,

        NULL AS avg_ispu,
        NULL AS max_ispu,
        NULL AS min_ispu

      FROM sensor_data
      ${where}
    `).get(...params);


    return res.json({
      success: true,

      message:
        'Statistik merupakan ringkasan data mentah sensor dan bukan hasil evaluasi baku mutu.',

      data: stats
    });
  } catch (error) {
    console.error(
      '[GET SENSOR STATS ERROR]',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil statistik sensor.',
      error: error.message
    });
  }
});


module.exports = router;