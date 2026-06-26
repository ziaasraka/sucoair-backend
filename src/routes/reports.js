// ============================================================
// routes/reports.js — Laporan Inspeksi
// GET    /api/reports
// POST   /api/reports
// DELETE /api/reports/:id
// ============================================================
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db      = require('../utils/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/reports — daftar laporan (bisa filter by company)
router.get('/', (req, res) => {
  const { company_id } = req.query;
  let sql = `
    SELECT r.*, c.name AS company_name
    FROM reports r
    LEFT JOIN companies c ON r.company_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (company_id) { sql += ' AND r.company_id = ?'; params.push(company_id); }
  sql += ' ORDER BY r.created_at DESC';

  res.json({ success: true, data: db.prepare(sql).all(...params) });
});

// POST /api/reports — buat laporan baru
router.post('/', (req, res) => {
  const { company_id, inspection_id, title, period, format, notes } = req.body;
  if (!company_id || !title) {
    return res.status(400).json({ success: false, message: 'company_id dan title wajib diisi.' });
  }

  const id = `RPT-${Date.now()}`;
  db.prepare(`
    INSERT INTO reports (id, company_id, inspection_id, title, period, format, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, inspection_id || null, title, period || '', format || 'Excel', notes || '', req.user.id);

  res.status(201).json({ success: true, id, message: 'Laporan berhasil dibuat.' });
});

// DELETE /api/reports/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM reports WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Laporan berhasil dihapus.' });
});

module.exports = router;
