// ============================================================
// routes/users.js — Manajemen User (Admin Only)
// GET    /api/users
// POST   /api/users
// PUT    /api/users/:id
// DELETE /api/users/:id
// ============================================================
const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../utils/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// GET /api/users
router.get('/', (req, res) => {
  const users = db.prepare(
    'SELECT id, username, name, role, created_at FROM users ORDER BY id'
  ).all();
  res.json({ success: true, data: users });
});

// POST /api/users
router.post('/', (req, res) => {
  const { username, password, name, role } = req.body;
  if (!username || !password || !name || !role) {
    return res.status(400).json({ success: false, message: 'Semua field wajib diisi.' });
  }
  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ success: false, message: 'Role tidak valid.' });
  }

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) {
    return res.status(409).json({ success: false, message: 'Username sudah digunakan.' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)'
  ).run(username, hash, name, role);

  res.status(201).json({ success: true, id: result.lastInsertRowid, message: 'User berhasil ditambahkan.' });
});

// PUT /api/users/:id
router.put('/:id', (req, res) => {
  const { name, role, password } = req.body;
  const { id } = req.params;

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });

  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET name=?, role=?, password=? WHERE id=?').run(name, role, hash, id);
  } else {
    db.prepare('UPDATE users SET name=?, role=? WHERE id=?').run(name, role, id);
  }

  res.json({ success: true, message: 'User berhasil diperbarui.' });
});

// DELETE /api/users/:id
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ success: false, message: 'Tidak dapat menghapus akun sendiri.' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ success: true, message: 'User berhasil dihapus.' });
});

module.exports = router;
