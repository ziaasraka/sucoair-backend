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
const { v4: uuidv4 } = require('uuid');
const db      = require('../utils/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/inspections — semua sesi (bisa filter by company)
router.get('/', (req, res) => {
  const { company_id, status } = req.query;
  let sql = `
    SELECT i.*, c.name AS company_name
    FROM inspections i
    LEFT JOIN companies c ON i.company_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (company_id) { sql += ' AND i.company_id = ?'; params.push(company_id); }
  if (status)     { sql += ' AND i.status = ?';     params.push(status); }
  sql += ' ORDER BY i.started_at DESC';

  res.json({ success: true, data: db.prepare(sql).all(...params) });
});

// GET /api/inspections/:id
router.get('/:id', (req, res) => {
  const insp = db.prepare(`
    SELECT i.*, c.name AS company_name, c.address AS company_address
    FROM inspections i
    LEFT JOIN companies c ON i.company_id = c.id
    WHERE i.id = ?
  `).get(req.params.id);

  if (!insp) return res.status(404).json({ success: false, message: 'Inspeksi tidak ditemukan.' });
  res.json({ success: true, data: insp });
});

// POST /api/inspections — buat sesi baru
router.post('/', (req, res) => {
  const { company_id, location, duration, notes } = req.body;
  if (!company_id || !location) {
    return res.status(400).json({ success: false, message: 'company_id dan location wajib diisi.' });
  }

  const id = `INS-${Date.now()}`;
  db.prepare(`
    INSERT INTO inspections (id, company_id, location, duration, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, company_id, location, duration || '1 hari', notes || '', req.user.id);

  res.status(201).json({ success: true, id, message: 'Sesi inspeksi berhasil dibuat.' });
});

// PUT /api/inspections/:id/selesai
router.put('/:id/selesai', (req, res) => {
  const insp = db.prepare('SELECT id, status FROM inspections WHERE id = ?').get(req.params.id);
  if (!insp) return res.status(404).json({ success: false, message: 'Inspeksi tidak ditemukan.' });
  if (insp.status === 'Selesai') return res.status(400).json({ success: false, message: 'Inspeksi sudah selesai.' });

  db.prepare(`
    UPDATE inspections SET status='Selesai', ended_at=datetime('now','localtime') WHERE id=?
  `).run(req.params.id);

  res.json({ success: true, message: 'Inspeksi berhasil diselesaikan.' });
});

// DELETE /api/inspections/:id
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;

    const insp = db.prepare('SELECT id FROM inspections WHERE id = ?').get(id);

    if (!insp) {
      return res.status(404).json({
        success: false,
        message: 'Sesi inspeksi tidak ditemukan.'
      });
    }

    // Hapus data terkait terlebih dahulu
    db.prepare('DELETE FROM sensor_data WHERE inspection_id = ?').run(id);
    db.prepare('DELETE FROM reports WHERE inspection_id = ?').run(id);

    // Baru hapus data inspeksi
    const result = db.prepare('DELETE FROM inspections WHERE id = ?').run(id);

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

// GET /api/inspections/:id/sensor — riwayat data sensor (paginasi)
router.get('/:id/sensor', (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  const data = db.prepare(`
    SELECT * FROM sensor_data
    WHERE inspection_id = ?
    ORDER BY recorded_at DESC
    LIMIT ? OFFSET ?
  `).all(req.params.id, +limit, +offset);

  const total = db.prepare(
    'SELECT COUNT(*) AS n FROM sensor_data WHERE inspection_id = ?'
  ).get(req.params.id).n;

  res.json({ success: true, total, data });
});

// GET /api/inspections/:id/latest — 1 data sensor terbaru
router.get('/:id/latest', (req, res) => {
  const row = db.prepare(`
    SELECT * FROM sensor_data
    WHERE inspection_id = ?
    ORDER BY recorded_at DESC LIMIT 1
  `).get(req.params.id);

  if (!row) return res.status(404).json({ success: false, message: 'Belum ada data sensor.' });
  if (row.membership) row.membership = JSON.parse(row.membership);
  res.json({ success: true, data: row });
});

module.exports = router;
