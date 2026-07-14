// ============================================================
// routes/bakuMutu.js
//
// Evaluasi baku mutu udara ambien per sesi inspeksi.
//
// Endpoint:
// GET /api/baku-mutu/inspection/:inspectionId
//
// Data hanya diambil dari sensor_data yang memiliki:
// inspection_id = ID inspeksi yang diminta
//
// Data monitoring umum dengan inspection_id = null tidak ikut
// dihitung ke dalam hasil inspeksi.
// ============================================================

const express = require('express');
const db = require('../utils/database');
const { requireAuth } = require('../middleware/auth');

const {
  BAKU_MUTU,
  evaluateParameter,
  buildConclusion,
} = require('../utils/bakumutu');

const router = express.Router();

router.use(requireAuth);

// Toleransi dipakai karena data ESP32 dikirim berkala.
// Contoh interval 5 menit:
// data 24 jam biasanya memiliki selisih waktu 23 jam 55 menit
// antara pembacaan pertama dan terakhir.
const DEFAULT_TOLERANCE_MS = 6 * 60 * 1000;


// ============================================================
// Helper tanggal database
// ============================================================

function parseDatabaseDate(value) {
  if (!value) return null;

  const raw = String(value).trim();

  let date;

  // Format ISO seperti:
  // 2026-07-14T12:00:00.000Z
  if (raw.includes('T')) {
    date = new Date(raw);
  }

  // Format SQLite seperti:
  // 2026-07-14 12:00:00
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) {
    date = new Date(raw.replace(' ', 'T') + 'Z');
  }

  else {
    date = new Date(raw);
  }

  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}


// ============================================================
// Helper angka
// ============================================================

function round(value, digits = 2) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return Number(number.toFixed(digits));
}

function calculateAverage(rows, field) {
  const values = rows
    .map((row) => Number(row[field]))
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);

  return round(total / values.length, 4);
}


// ============================================================
// Perkirakan interval kirim data
//
// Contoh:
// 10:00
// 10:05
// 10:10
//
// Interval diperkirakan 5 menit.
// ============================================================

function estimateSamplingIntervalMs(rows) {
  if (!rows || rows.length < 2) {
    return DEFAULT_TOLERANCE_MS;
  }

  const differences = [];

  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]._timestamp;
    const current = rows[index]._timestamp;

    if (!previous || !current) continue;

    const difference = current - previous;

    if (difference > 0) {
      differences.push(difference);
    }
  }

  if (differences.length === 0) {
    return DEFAULT_TOLERANCE_MS;
  }

  differences.sort((a, b) => a - b);

  const middle = Math.floor(differences.length / 2);

  const median =
    differences.length % 2 === 0
      ? (differences[middle - 1] + differences[middle]) / 2
      : differences[middle];

  // Toleransi minimal 6 menit.
  // Jika interval sensor lebih besar, toleransi mengikuti interval.
  return Math.max(DEFAULT_TOLERANCE_MS, median * 1.2);
}


// ============================================================
// Menyiapkan data berdasarkan periode
//
// Jika periode sudah lengkap:
// data yang dihitung adalah data pada periode terakhir.
//
// Jika periode belum lengkap:
// seluruh data yang tersedia tetap dihitung sebagai rata-rata
// sementara, tetapi status menjadi "Belum Cukup Data".
// ============================================================

function getRowsForPeriod(allRows, periodHours) {
  if (!allRows || allRows.length === 0) {
    return {
      rows: [],
      dataComplete: false,
      availableHours: 0,
      requiredHours: periodHours,
      samplingIntervalMinutes: null,
      startTime: null,
      endTime: null,
      calculationBasis: 'Belum ada data',
    };
  }

  const validRows = allRows
    .map((row) => {
      const date = parseDatabaseDate(row.recorded_at);

      return {
        ...row,
        _date: date,
        _timestamp: date ? date.getTime() : null,
      };
    })
    .filter((row) => row._timestamp !== null)
    .sort((a, b) => a._timestamp - b._timestamp);

  if (validRows.length === 0) {
    return {
      rows: [],
      dataComplete: false,
      availableHours: 0,
      requiredHours: periodHours,
      samplingIntervalMinutes: null,
      startTime: null,
      endTime: null,
      calculationBasis: 'Format waktu data tidak valid',
    };
  }

  const firstRow = validRows[0];
  const lastRow = validRows[validRows.length - 1];

  const requiredMs = periodHours * 60 * 60 * 1000;
  const availableMs = Math.max(
    0,
    lastRow._timestamp - firstRow._timestamp
  );

  const toleranceMs = estimateSamplingIntervalMs(validRows);

  const dataComplete =
    availableMs + toleranceMs >= requiredMs;

  let selectedRows = validRows;
  let calculationBasis =
    'Rata-rata sementara dari seluruh data yang tersedia';

  if (dataComplete) {
    const periodStartTimestamp =
      lastRow._timestamp - requiredMs;

    selectedRows = validRows.filter((row) => {
      return (
        row._timestamp >= periodStartTimestamp &&
        row._timestamp <= lastRow._timestamp
      );
    });

    calculationBasis =
      `Rata-rata periode ${periodHours} jam terakhir`;
  }

  return {
    rows: selectedRows,
    dataComplete,
    availableHours: round(availableMs / (60 * 60 * 1000), 2),
    requiredHours: periodHours,
    samplingIntervalMinutes: round(
      toleranceMs / 1.2 / (60 * 1000),
      2
    ),
    startTime: selectedRows[0]?.recorded_at || null,
    endTime:
      selectedRows[selectedRows.length - 1]?.recorded_at || null,
    calculationBasis,
  };
}


// ============================================================
// Evaluasi satu parameter dan satu periode
// ============================================================

function evaluateStandard(allRows, parameterKey, standard) {
  const periodData = getRowsForPeriod(
    allRows,
    standard.hours
  );

  const average = calculateAverage(
    periodData.rows,
    parameterKey
  );

  const evaluation = evaluateParameter(
    parameterKey,
    standard.key,
    average,
    periodData.dataComplete
  );

  return {
    ...evaluation,

    period_key: standard.key,

    sample_count: periodData.rows.length,

    available_hours: periodData.availableHours,

    required_hours: periodData.requiredHours,

    estimated_sampling_interval_minutes:
      periodData.samplingIntervalMinutes,

    period_start: periodData.startTime,

    period_end: periodData.endTime,

    calculation_basis: periodData.calculationBasis,
  };
}


// ============================================================
// GET /api/baku-mutu/inspection/:inspectionId
// ============================================================

router.get('/inspection/:inspectionId', (req, res) => {
  try {
    const { inspectionId } = req.params;

    // Ambil informasi inspeksi
    const inspection = db.prepare(`
      SELECT
        i.id,
        i.company_id,
        i.location,
        i.duration,
        i.status,
        i.started_at,
        i.ended_at,
        c.name AS company_name
      FROM inspections i
      LEFT JOIN companies c
        ON c.id = i.company_id
      WHERE i.id = ?
    `).get(inspectionId);

    if (!inspection) {
      return res.status(404).json({
        success: false,
        message: 'Sesi inspeksi tidak ditemukan.',
      });
    }

    // Hanya mengambil data yang benar-benar terkait inspeksi.
    // Data monitoring umum dengan inspection_id null tidak ikut.
    const sensorRows = db.prepare(`
      SELECT
        id,
        inspection_id,
        recorded_at,
        pm25,
        pm10,
        co,
        no2,
        so2,
        o3,
        temperature,
        humidity
      FROM sensor_data
      WHERE inspection_id = ?
      ORDER BY recorded_at ASC
    `).all(inspectionId);

    const results = {};

    // Evaluasi seluruh parameter dan seluruh periode baku mutu.
    for (const [parameterKey, configuration] of Object.entries(
      BAKU_MUTU
    )) {
      for (const standard of configuration.standards) {
        const resultKey =
          `${parameterKey}_${standard.key}`;

        results[resultKey] = evaluateStandard(
          sensorRows,
          parameterKey,
          standard
        );
      }
    }

    const conclusion = buildConclusion(results);

    const firstData =
      sensorRows.length > 0
        ? sensorRows[0].recorded_at
        : null;

    const lastData =
      sensorRows.length > 0
        ? sensorRows[sensorRows.length - 1].recorded_at
        : null;

    res.json({
      success: true,

      data: {
        method:
          'Evaluasi Baku Mutu Udara Ambien per Parameter',

        reference:
          'Lampiran VII Peraturan Pemerintah Republik Indonesia Nomor 22 Tahun 2021',

        inspection: {
          id: inspection.id,
          company_id: inspection.company_id,
          company_name: inspection.company_name,
          location: inspection.location,
          duration: inspection.duration,
          status: inspection.status,
          started_at: inspection.started_at,
          ended_at: inspection.ended_at,
        },

        measurement: {
          total_records: sensorRows.length,
          first_recorded_at: firstData,
          last_recorded_at: lastData,
        },

        results,

        conclusion,
      },
    });
  } catch (error) {
    console.error(
      '[GET INSPECTION BAKU MUTU ERROR]',
      error.message
    );

    res.status(500).json({
      success: false,
      message:
        'Gagal menghitung evaluasi baku mutu inspeksi.',
      error: error.message,
    });
  }
});

module.exports = router;