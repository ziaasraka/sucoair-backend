// ============================================================
// routes/companies.js — Manajemen Perusahaan
// GET    /api/companies
// POST   /api/companies
// PUT    /api/companies/:id
// DELETE /api/companies/:id
// ============================================================
const express = require('express');
const db      = require('../utils/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/companies — daftar semua perusahaan
router.get('/', (req, res) => {
  const companies = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM inspections WHERE company_id = c.id) AS total_inspeksi
    FROM companies c
    ORDER BY c.name
  `).all();
  res.json({ success: true, data: companies });
});

// GET /api/companies/:id
router.get('/:id', (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ success: false, message: 'Perusahaan tidak ditemukan.' });
  res.json({ success: true, data: company });
});

// POST /api/companies
router.post('/', (req, res) => {
  const { name, address } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'Nama perusahaan wajib diisi.' });

  const result = db.prepare(
    'INSERT INTO companies (name, address) VALUES (?, ?)'
  ).run(name, address || '');

  res.status(201).json({ success: true, id: result.lastInsertRowid, message: 'Perusahaan berhasil ditambahkan.' });
});

// PUT /api/companies/:id
router.put('/:id', (req, res) => {
  const { name, address } = req.body;
  const co = db.prepare('SELECT id FROM companies WHERE id = ?').get(req.params.id);
  if (!co) return res.status(404).json({ success: false, message: 'Perusahaan tidak ditemukan.' });

  db.prepare('UPDATE companies SET name=?, address=? WHERE id=?').run(name, address, req.params.id);
  res.json({ success: true, message: 'Perusahaan berhasil diperbarui.' });
});

// DELETE /api/companies/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM companies WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Perusahaan berhasil dihapus.' });
});

module.exports = router;
