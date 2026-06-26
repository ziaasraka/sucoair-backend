// ============================================================
// routes/auth.js — Login & Auth
// POST /api/auth/login
// GET  /api/auth/me
// ============================================================
const express  = require('express');
const bcrypt   = require('bcryptjs');
const db       = require('../utils/database');
const { generateToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Username tidak ditemukan.' });
  }

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) {
    return res.status(401).json({ success: false, message: 'Password salah.' });
  }

  const token = generateToken(user);

  res.json({
    success: true,
    token,
    user: {
      id:       user.id,
      username: user.username,
      name:     user.name,
      role:     user.role,
    },
  });
});

// GET /api/auth/me — cek token aktif
router.get('/me', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

module.exports = router;
