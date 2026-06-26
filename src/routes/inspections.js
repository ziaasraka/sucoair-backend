// ============================================================
// routes/inspections.js — Sesi Inspeksi
// GET    /api/inspections
// POST   /api/inspections
// GET    /api/inspections/:id
// PUT    /api/inspections/:id/selesai
// DELETE /api/inspections/:id
// GET    /api/inspections/:id/sensor  — riwayat data sensor
// GET    /api/inspections/:id/latest  — data sensor terbaru
// ============================================================

const express = require('express');
const db = require('../utils/database');
const { requireAuth } = require('../middleware/auth');

const {
  finalizeExpiredInspections,
  getActiveInspection,
  finishInspection
} = require('../utils/inspectionAutoClose');

const router = express.Router();

router.use(requireAuth);

// ============================================================
// GET /api/inspections — semua sesi inspeksi
// Bisa filter:
// ?company_id=...
// ?status=...
// ============================================================
router.get('/', (req, res) => {
  try {
    // Cek dulu apakah ada sesi yang durasinya sudah habis
    finalizeExpiredInspections();

    const { company_id, status } = req.query;

    let sql = `
      SELECT i.*, c.name AS company_name
      FROM inspections i
      LEFT JOIN companies c ON i.company_id = c.id
      WHERE 1=1
    `;

    const params = [];

    if (company_id) {
      sql += ' AND i.company_id = ?';
      params.push(company_id);
    }

    if (status) {
      sql += ' AND i.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY i.started_at DESC';

    const data = db.prepare(sql).all(...params);

    res.json({
      success: true,
      data
    });
  } catch (err) {
    console.error('[GET INSPECTIONS ERROR]', err.message);

    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data inspeksi.',
      error: err.message
    });
  }
});

// ============================================================
// POST /api/inspections — buat sesi inspeksi baru
// Sistem hanya mengizinkan 1 sesi berlangsung dalam satu waktu
// karena ESP32 yang digunakan hanya 1 sumber data realtime.
// ============================================================
router.post('/', (req, res) => {
  try {
    // Sebelum membuat sesi baru, cek dulu sesi lama yang mungkin sudah habis durasinya
    finalizeExpiredInspections();

    const { company_id, location, duration, notes } = req.body;

    if (!company_id || !location) {
      return res.status(400).json({
        success: false,
        message: 'company_id dan location wajib diisi.'
      });
    }

    // Cek apakah masih ada sesi inspeksi yang berlangsung
    const activeInspection = getActiveInspection();

    if (activeInspection) {
      return res.status(400).json({
        success: false,
        message: `Masih ada sesi inspeksi yang berlangsung: ${activeInspection.id}. Selesaikan dulu sebelum membuat sesi baru.`
      });
    }

    const id = `INS-${Date.now()}`;

    db.prepare(`
      INSERT INTO inspections
        (id, company_id, location, duration, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      company_id,
      location,
      duration || '1 jam',
      notes || '',
      req.user.id
    );

    res.status(201).json({
      success: true,
      id,
      message: 'Sesi inspeksi berhasil dibuat.'
    });
  } catch (err) {
    console.error('[CREATE INSPECTION ERROR]', err.message);

    res.status(500).json({
      success: false,
      message: 'Gagal membuat sesi inspeksi.',
      error: err.message
    });
  }
});

// ============================================================
// GET /api/inspections/:id — detail inspeksi
// ============================================================
router.get('/:id', (req, res) => {
  try {
    finalizeExpiredInspections();

    const insp = db.prepare(`
      SELECT i.*, c.name AS company_name, c.address AS company_address
      FROM inspections i
      LEFT JOIN companies c ON i.company_id = c.id
      WHERE i.id = ?
    `).get(req.params.id);

    if (!insp) {
      return res.status(404).json({
        success: false,
        message: 'Inspeksi tidak ditemukan.'
      });
    }

    res.json({
      success: true,
      data: insp
    });
  } catch (err) {
    console.error('[GET INSPECTION DETAIL ERROR]', err.message);

    res.status(500).json({
      success: false,
      message: 'Gagal mengambil detail inspeksi.',
      error: err.message
    });
  }
});

// ============================================================
// PUT /api/inspections/:id/selesai
// Selesaikan sesi inspeksi manual
// Sekaligus membuat laporan otomatis jika belum ada.
// ============================================================
router.put('/:id/selesai', (req, res) => {
  try {
    const result = finishInspection(req.params.id);

    return res.status(result.status).json({
      success: result.success,
      message: result.message
    });
  } catch (err) {
    console.error('[FINISH INSPECTION ERROR]', err.message);

    res.status(500).json({
      success: false,
      message: 'Gagal menyelesaikan inspeksi.',
      error: err.message
    });
  }
});

// ============================================================
// DELETE /api/inspections/:id
// Hapus sesi inspeksi beserta data sensor dan laporan terkait
// ============================================================
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;

    const insp = db.prepare(`
      SELECT id
      FROM inspections
      WHERE id = ?
    `).get(id);

    if (!insp) {
      return res.status(404).json({
        success: false,
        message: 'Sesi inspeksi tidak ditemukan.'
      });
    }

    // Hapus data sensor yang terkait dengan inspeksi ini
    db.prepare(`
      DELETE FROM sensor_data
      WHERE inspection_id = ?
    `).run(id);

    // Hapus laporan yang terkait dengan inspeksi ini
    db.prepare(`
      DELETE FROM reports
      WHERE inspection_id = ?
    `).run(id);

    // Hapus sesi inspeksi
    const result = db.prepare(`
      DELETE FROM inspections
      WHERE id = ?
    `).run(id);

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        message: 'Sesi inspeksi gagal dihapus.'
      });
    }

    res.json({
      success: true,
      message: 'Sesi inspeksi berhasil dihapus.'
    });
  } catch (err) {
    console.error('[DELETE INSPECTION ERROR]', err.message);

    res.status(500).json({
      success: false,
      message: 'Gagal menghapus sesi inspeksi.',
      error: err.message
    });
  }
});

// ============================================================
// GET /api/inspections/:id/sensor
// Riwayat data sensor berdasarkan inspection_id
// Query:
// ?limit=100
// ?offset=0
// ============================================================
router.get('/:id/sensor', (req, res) => {
  try {
    finalizeExpiredInspections();

    const { limit = 100, offset = 0 } = req.query;

    const data = db.prepare(`
      SELECT *
      FROM sensor_data
      WHERE inspection_id = ?
      ORDER BY recorded_at DESC
      LIMIT ? OFFSET ?
    `).all(req.params.id, Number(limit), Number(offset));

    const total = db.prepare(`
      SELECT COUNT(*) AS n
      FROM sensor_data
      WHERE inspection_id = ?
    `).get(req.params.id).n;

    const parsedData = data.map((row) => ({
      ...row,
      membership: row.membership ? JSON.parse(row.membership) : null
    }));

    res.json({
      success: true,
      total,
      data: parsedData
    });
  } catch (err) {
    console.error('[GET INSPECTION SENSOR ERROR]', err.message);

    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data sensor inspeksi.',
      error: err.message
    });
  }
});

// ============================================================
// GET /api/inspections/:id/latest
// Data sensor terbaru dari sesi inspeksi tertentu
// ============================================================
router.get('/:id/latest', (req, res) => {
  try {
    finalizeExpiredInspections();

    const row = db.prepare(`
      SELECT *
      FROM sensor_data
      WHERE inspection_id = ?
      ORDER BY recorded_at DESC
      LIMIT 1
    `).get(req.params.id);

    if (!row) {
      return res.status(404).json({
        success: false,
        message: 'Belum ada data sensor.'
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
    console.error('[GET INSPECTION LATEST ERROR]', err.message);

    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data sensor terbaru.',
      error: err.message
    });
  }
});

module.exports = router;