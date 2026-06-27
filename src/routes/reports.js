// ============================================================
// routes/reports.js — Laporan Inspeksi
// GET    /api/reports
// POST   /api/reports
// DELETE /api/reports/:id
// ============================================================

const express = require('express');
const db = require('../utils/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// ============================================================
// GET /api/reports — daftar laporan
// Bisa filter:
// ?company_id=...
// ============================================================
router.get('/', (req, res) => {
  try {
    const { company_id } = req.query;

    let sql = `
      SELECT r.*, c.name AS company_name
      FROM reports r
      LEFT JOIN companies c ON r.company_id = c.id
      WHERE 1=1
    `;

    const params = [];

    if (company_id) {
      sql += ' AND r.company_id = ?';
      params.push(company_id);
    }

    sql += ' ORDER BY r.created_at DESC';

    const data = db.prepare(sql).all(...params);

    res.json({
      success: true,
      data
    });
  } catch (err) {
    console.error('[GET REPORTS ERROR]', err.message);

    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data laporan.',
      error: err.message
    });
  }
});

// ============================================================
// POST /api/reports — buat laporan baru
// Dicegah agar 1 inspection_id tidak punya laporan ganda
// ============================================================
router.post('/', (req, res) => {
  try {
    const {
      company_id,
      inspection_id,
      title,
      period,
      format,
      notes
    } = req.body;

    if (!company_id || !title) {
      return res.status(400).json({
        success: false,
        message: 'company_id dan title wajib diisi.'
      });
    }

    // Cegah laporan ganda untuk sesi inspeksi yang sama
    if (inspection_id) {
      const existing = db.prepare(`
        SELECT id
        FROM reports
        WHERE inspection_id = ?
        LIMIT 1
      `).get(inspection_id);

      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'Laporan untuk sesi inspeksi ini sudah ada.'
        });
      }
    }

    const id = `RPT-${Date.now()}`;

    db.prepare(`
      INSERT INTO reports
        (
          id,
          company_id,
          inspection_id,
          title,
          period,
          format,
          notes,
          created_by
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      company_id,
      inspection_id || null,
      title,
      period || '',
      format || 'Excel',
      notes || '',
      req.user.id
    );

    res.status(201).json({
      success: true,
      id,
      message: 'Laporan berhasil dibuat.'
    });
  } catch (err) {
    console.error('[CREATE REPORT ERROR]', err.message);

    res.status(500).json({
      success: false,
      message: 'Gagal membuat laporan.',
      error: err.message
    });
  }
});

// ============================================================
// DELETE /api/reports/:id — hapus laporan
// ============================================================
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;

    const result = db.prepare(`
      DELETE FROM reports
      WHERE id = ?
    `).run(id);

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        message: 'Laporan tidak ditemukan.'
      });
    }

    res.json({
      success: true,
      message: 'Laporan berhasil dihapus.'
    });
  } catch (err) {
    console.error('[DELETE REPORT ERROR]', err.message);

    res.status(500).json({
      success: false,
      message: 'Gagal menghapus laporan.',
      error: err.message
    });
  }
});

module.exports = router;